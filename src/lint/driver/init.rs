//! `bun lint --init` and `bun fmt --init`. Adds the command's section to the bunfig.toml in the working directory, unless one
//! above it has the section: a new one would take its place.

use crate::format::summary::write_error;
use crate::run::{Environment, Outcome};
use crate::{fs, paths};
use bun_core::strings::{self, BOM};
use bun_lint::json::{Notation, with_parsed};
use std::borrow::Cow;

/// The section one command adds.
pub(crate) struct Section {
    name: &'static str,
    /// Everything after the `[name]` header. Each commented-out line is a valid setting once its `# ` is removed.
    body: &'static str,
    /// The `package.json` key that holds the config of the tool this command replaces.
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
    name: "fmt",
    body: "# printWidth = 100\n# semi = false\n",
    key_in_package: "prettier",
};

fn cannot(verb: &str, why: &[u8]) -> Vec<u8> {
    [b"Cannot ", verb.as_bytes(), b" bunfig.toml: ", why].concat()
}

impl Section {
    fn text(&self, line_break: &[u8]) -> Vec<u8> {
        let text = format!("[{}]\n{}", self.name, self.body);
        strings::replace_owned(text.as_bytes(), b"\n", line_break)
    }

    /// `Ok` says what was done. `Err` says why nothing was.
    fn try_add(
        &self,
        other: Option<&[u8]>,
        above: Option<&[u8]>,
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
        if let Some(above) = above {
            let end = format!(" already has a [{}] section", self.name);
            return Ok([above, end.as_bytes()].concat());
        }
        let path = paths::join(cwd, b"bunfig.toml");
        let before = match fs::read(&path) {
            Ok(before) => before,
            Err(error) if error.get_errno() == bun_sys::E::ENOENT => {
                fs::write_new(&path, &self.text(b"\n"))
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
        // Leave one empty line between the existing content and the new section.
        let written = text.trim_ascii_end().len();
        let wanted: usize = if written == 0 { 0 } else { 2 };
        let is_in_a_line = !text.is_empty() && !text.ends_with(b"\n");
        let breaks = wanted
            .saturating_sub(strings::count_char(&text[written..], b'\n'))
            .max(usize::from(is_in_a_line));
        let mut added = [line_break.repeat(breaks), self.text(line_break)].concat();
        if bom == Some(BOM::Utf16Le) {
            added = added.iter().flat_map(|it| [*it, 0]).collect();
        }
        fs::write_atomically(
            &fs::Written::default(),
            cwd,
            &path,
            &[before, added].concat(),
        )
        .map_err(|why| cannot("write", &why))?;
        Ok(format!("Added [{}] to bunfig.toml", self.name).into_bytes())
    }

    /// `other` is another tool's config file, if one applies in the working directory. `above` is the path of the bunfig
    /// above the working directory whose section the run has found.
    #[optimize(size)]
    pub(crate) fn add(
        &self,
        other: Option<&[u8]>,
        above: Option<&[u8]>,
        environment: &Environment,
    ) -> Outcome {
        let mut out = Outcome::default();
        match self.try_add(other, above, &environment.cwd) {
            Ok(done) => out.stdout = [&done[..], b"\n"].concat(),
            Err(why) => {
                write_error(&mut out.stderr, environment.stderr.colors, &why);
                out.exit_code = 2;
            }
        }
        out
    }
}
