//! Formatters for `fetch(url, { verbose: true })` and `BUN_CONFIG_VERBOSE_FETCH`.

use core::fmt;

use bstr::BStr;
use bun_core::fmt::{escape_control_chars, for_terminal};
use bun_core::output::enable_ansi_colors_stderr;
use bun_core::{pretty_fmt, strings, write_pretty};
use bun_http_types::ETag::Header;

use crate::{Request, Response};

pub(crate) struct HeaderFormatter<'a>(pub(crate) Header<'a>);

impl fmt::Display for HeaderFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = escape_control_chars(self.0.name());
        let value = for_terminal(BStr::new(self.0.value()));
        let colors = enable_ansi_colors_stderr();
        write_pretty!(f, colors, "<r><cyan>{}<r><d>: <r>{}", name, value)
    }
}

/// Text between the double quotes of a command-line argument.
enum Quoted<'a> {
    Url(&'a [u8]),
    Text(&'a [u8]),
    /// With its own quotes and backslashes.
    Json(&'a [u8]),
}

impl fmt::Display for Quoted<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (mut rest, special): (_, &[u8]) = match *self {
            Self::Url(text) | Self::Text(text) => (text, b"\"\\$`!"),
            Self::Json(text) => (text, b"$`!"),
        };
        while let Some(i) = strings::index_of_any(rest, special) {
            escape_control_chars(&rest[..i]).fmt(f)?;
            match (self, rest[i]) {
                (Self::Url(_), byte) => write!(f, "%{byte:02X}"),
                (_, byte @ (b'"' | b'\\')) => write!(f, "\\{}", char::from(byte)),
                (_, byte) => write!(f, "\"\\{}\"", char::from(byte)),
            }?;
            rest = &rest[i + 1..];
        }
        escape_control_chars(rest).fmt(f)
    }
}

pub(crate) struct CurlFormatter<'a> {
    pub(crate) request: &'a Request<'a>,
    pub(crate) url: &'a [u8],
    pub(crate) ignore_insecure: bool,
    pub(crate) body: &'a [u8],
}

fn is_printable_body(content_type: &[u8]) -> bool {
    strings::has_prefix(content_type, b"text/")
        || strings::contains(content_type, b"json")
        || strings::has_prefix(content_type, b"application/x-www-form-urlencoded")
}

impl fmt::Display for CurlFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let request = self.request;
        let colors = enable_ansi_colors_stderr();
        if colors {
            f.write_str(pretty_fmt!("<r><d>[fetch] $<r> ", true))?;
        }
        write_pretty!(
            f,
            colors,
            "<b><cyan>curl<r> <d>--http1.1<r> <b>\"{}\"<r>",
            Quoted::Url(self.url),
        )?;

        if request.method != b"GET" {
            write!(f, " -X {}", BStr::new(request.method))?;
        }

        if self.ignore_insecure {
            f.write_str(" -k")?;
        }

        let mut content_type: &[u8] = b"";

        for header in request.headers {
            let (name, value) = (header.name(), header.value());
            if content_type.is_empty()
                && strings::eql_case_insensitive_ascii(b"content-type", name, true)
            {
                content_type = value;
            }

            write!(f, " -H \"{}", Quoted::Text(name))?;
            if !value.is_empty() {
                write!(f, ": {}", Quoted::Text(value))?;
            }
            f.write_str("\"")?;

            if strings::eql_case_insensitive_ascii(b"accept-encoding", name, true) {
                f.write_str(" --compressed")?;
            }
        }

        if !self.body.is_empty() && is_printable_body(content_type) {
            let mut json = String::new();
            bun_core::js_printer::write_json_string(self.body, &mut json, strings::Encoding::Utf8)?;
            write!(f, " --data-raw {}", Quoted::Json(json.as_bytes()))?;
        }

        Ok(())
    }
}

struct StatusCodeFormatter(u32);

impl fmt::Display for StatusCodeFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let colors = enable_ansi_colors_stderr();
        match self.0 {
            101 | 200..=299 => write_pretty!(f, colors, "<r><green>{}<r>", self.0),
            300..=399 => write_pretty!(f, colors, "<r><yellow>{}<r>", self.0),
            _ => write_pretty!(f, colors, "<r><red>{}<r>", self.0),
        }
    }
}

pub(crate) struct ResponseFormatter<'a>(pub(crate) &'a Response);

impl fmt::Display for ResponseFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let prefix = if enable_ansi_colors_stderr() {
            pretty_fmt!("<r><d>[fetch]<r> ", true)
        } else {
            ""
        };
        writeln!(
            f,
            "{prefix}< {} {}",
            StatusCodeFormatter(self.0.status_code),
            escape_control_chars(self.0.status_text()),
        )?;
        for header in self.0.headers.iter() {
            writeln!(f, "{prefix}< {}", HeaderFormatter(header))?;
        }
        Ok(())
    }
}
