use bun_engine_text::{AllocError, StringRef, Text};

use crate::buffer::Buffer;
use crate::class::{BACKSLASH, FILE_PATH, FILE_PATH_SCAN};
use crate::components::{Components, State};
use crate::input::{Source, Transcoder};
use crate::parser::Parser;
use crate::path::PathSyntax;
use crate::record::{Record, Storage, concat};
use crate::{Punycode, Scheme, Url, percent};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PathStyle {
    Posix,
    Windows,
}

impl PathStyle {
    pub const NATIVE: PathStyle = if cfg!(windows) {
        PathStyle::Windows
    } else {
        PathStyle::Posix
    };
}

impl Url {
    /// A path that does not start with `/` gets one. Only the server of a UNC path can make the URL invalid.
    pub fn from_file_path(path: Text<'_>, style: PathStyle) -> Result<Url, AllocError> {
        let mut transcoder = Transcoder::new();
        let path = transcoder.source(path)?;
        let syntax = match style {
            PathStyle::Posix => PathSyntax {
                set: FILE_PATH | BACKSLASH,
                backslash_is_slash: false,
            },
            PathStyle::Windows => {
                if let [b'/' | b'\\', b'/' | b'\\', unc @ ..] = path.bytes
                    && !unc.is_empty()
                {
                    return Url::from_unc_path(path.with_bytes(unc));
                }
                PathSyntax {
                    set: FILE_PATH,
                    backslash_is_slash: true,
                }
            }
        };

        const PREFIX: &[u8] = b"file:///";
        let mut parts = Components {
            scheme_end: "file".len() as u32,
            scheme: Scheme::File,
            state: State::Hierarchical,
            ..Components::INVALID
        };
        parts.set_empty_authority(PREFIX.len() as u32 - 1);
        let start = usize::from(path.bytes.starts_with(b"/"));
        let mut parser = Parser::new(path, Punycode::Unchecked, parts);
        parser.out.start_with(PREFIX, start);
        let end = parser
            .segment_start(start, syntax)
            .and_then(|start| parser.path(&mut FILE_PATH_SCAN.scan(path.bytes, start), syntax))
            .map_err(|_| AllocError)?;
        let text = concat(parser.out.pieces(end))?;
        parts.path_end = text.len() as u32;
        parts.query_end = parts.path_end;
        Ok(Url {
            text: Some(text),
            parts,
        })
    }

    /// `path` starts with the server.
    #[cold]
    fn from_unc_path(path: Source<'_>) -> Result<Url, AllocError> {
        let mut href = Buffer::new();
        href.extend(b"file://")?;
        percent::encode(path, FILE_PATH, &mut href)?;
        let href = StringRef::try_from_units(&href)?;
        Ok(Url::parse_or_keep(&href, None, Punycode::Unchecked))
    }
}

impl<S: Storage> Record<S> {
    /// `None` unless the scheme is `file`, and for a POSIX path that is not UTF-8. A POSIX path ignores the host.
    pub fn file_path(&self, style: PathStyle) -> Result<Option<StringRef>, AllocError> {
        if self.scheme() != Scheme::File {
            return Ok(None);
        }
        match style {
            PathStyle::Posix => percent::decode_to_string(self.path()),
            PathStyle::Windows => self.windows_path().map(Some),
        }
    }

    fn windows_path(&self) -> Result<StringRef, AllocError> {
        let mut encoded = Buffer::new();
        encoded.extend(self.path())?;
        for byte in encoded.iter_mut().filter(|byte| **byte == b'/') {
            *byte = b'\\';
        }
        let mut path = Buffer::new();
        let server = self.hostname();
        if !server.is_empty() {
            path.extend(b"\\\\")?;
            path.extend(server)?;
        }
        let start = usize::from(server.is_empty());
        percent::percent_decode(&encoded[start..], |piece| path.extend(piece))?;
        StringRef::try_from_utf8_lossy(&path)
    }
}
