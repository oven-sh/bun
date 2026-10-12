//! `--init` of `bun lint` and `bun format`: adds the section of the command to the bunfig.toml in the working directory.

use crate::format::summary::write_error;
use crate::run::{Environment, Outcome};
use crate::{fs, paths};
use bun_core::strings::{self, BOM};
use bun_lint::json::{Notation, with_parsed};
use std::borrow::Cow;

/// What a command adds.
pub(crate) struct Section {
    name: &'static str,
    /// What follows the header. A line that is a comment is a setting without its `# `.
    body: &'static str,
    /// The key of a `package.json` that holds a configuration of the tool that the command can stand in for.
    key_in_package: &'static str,
}

pub(crate) const LINT: Section = Section {
    name: "lint",
    body: r##"# typeAware = true   # also run the rules that need types

[lint.rules]
# "no-console" = "warn"
# "eqeqeq" = ["error", "smart"]
"##,
    key_in_package: "eslintConfig",
};

pub(crate) const FORMAT: Section = Section {
    name: "format",
    body: "# printWidth = 100\n# semi = false\n",
    key_in_package: "prettier",
};

fn cannot(verb: &str, why: &[u8]) -> Vec<u8> {
    [b"Cannot ", verb.as_bytes(), b" bunfig.toml: ", why].concat()
}

impl Section {
    fn text(&self, flavor: Option<&str>, line_break: &[u8]) -> Vec<u8> {
        let flavor = flavor.map_or_else(String::new, |it| format!("flavor = \"{it}\"\n"));
        let text = format!("[{}]\n{flavor}{}", self.name, self.body);
        strings::replace_owned(text.as_bytes(), b"\n", line_break)
    }

    /// `Ok`: what has been done. `Err`: why nothing has.
    fn try_add(
        &self,
        flavor: Option<&str>,
        other: Option<&[u8]>,
        cwd: &[u8],
    ) -> Result<Vec<u8>, Vec<u8>> {
        if let Some(other) = other {
            let key = match paths::basename(other).starts_with(b"package.") {
                true => format!("{} in ", self.key_in_package),
                false => String::new(),
            };
            let shown = paths::relative(cwd, other);
            let end = b". bunfig.toml is not needed.";
            return Ok([b"Using ", key.as_bytes(), &shown, end].concat());
        }
        let path = paths::join(cwd, b"bunfig.toml");
        let before = match fs::read(&path) {
            Ok(before) => before,
            Err(error) if error.get_errno() == bun_sys::E::ENOENT => {
                fs::write_new(&path, &self.text(flavor, b"\n"))
                    .map_err(|error| cannot("write", &fs::describe(&error)))?;
                return Ok(
                    format!("Created bunfig.toml with a [{}] section", self.name).into_bytes(),
                );
            }
            Err(error) => return Err(cannot("read", &fs::describe(&error))),
        };
        let bom = BOM::detect(&before);
        let text = match bom {
            Some(bom) => Cow::Owned(bom.remove_and_convert_to_utf8_and_free(before.clone())),
            None => Cow::Borrowed(&before[..]),
        };
        let has_section = |file: &bun_ast::Expr| file.get(self.name.as_bytes()).is_some();
        let has_section = with_parsed(Notation::Toml, &text, has_section).map_err(|error| {
            let place = format!("\n  at bunfig.toml:{}:{}", error.line, error.column);
            cannot("read", &[&error.message[..], place.as_bytes()].concat())
        })?;
        if has_section {
            return Ok(format!("bunfig.toml already has a [{}] section", self.name).into_bytes());
        }
        let line_break: &[u8] = match strings::index_of(&text, b"\r\n") {
            Some(at) if !strings::contains_char(&text[..at], b'\n') => b"\r\n",
            _ => b"\n",
        };
        // An empty line after what is there.
        let written = text.trim_ascii_end().len();
        let wanted: usize = if written == 0 { 0 } else { 2 };
        let is_in_a_line = !text.is_empty() && !text.ends_with(b"\n");
        let breaks = wanted
            .saturating_sub(strings::count_char(&text[written..], b'\n'))
            .max(usize::from(is_in_a_line));
        let mut added = [line_break.repeat(breaks), self.text(flavor, line_break)].concat();
        if bom == Some(BOM::Utf16Le) {
            added = added.iter().flat_map(|it| [*it, 0]).collect();
        }
        fs::write_atomically(cwd, &path, &[before, added].concat())
            .map_err(|why| cannot("write", &why))?;
        Ok(format!("Added [{}] to bunfig.toml", self.name).into_bytes())
    }

    /// `flavor`: `--flavor`, which is kept for the runs to come. `other`: the configuration file of another tool that counts in the
    /// working directory.
    pub(crate) fn add(
        &self,
        flavor: Option<&str>,
        other: Option<&[u8]>,
        environment: &Environment,
    ) -> Outcome {
        let mut out = Outcome::default();
        match self.try_add(flavor, other, &environment.cwd) {
            Ok(done) => out.stdout = [&done[..], b"\n"].concat(),
            Err(why) => {
                write_error(&mut out.stderr, environment.stderr.colors, &why);
                out.exit_code = 2;
            }
        }
        out
    }
}
