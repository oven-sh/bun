//! What a rule that holds a file against its formatted text sees of the formatter.
//!
//! The printers, and what finds the configuration of Prettier for a file, are above this crate. Whoever lints the files provides
//! them: [`File::formatter`].
//!
//! A rule stands in for that of a package only where the text is byte for byte what the package would get. So [`Formats`] says
//! for each file whether it is: [`Formatted::NotNative`]. The rule then reports nothing and [hands the file back](File::hand_back):
//! the rule of the package looks at it.

use crate::ast::File;
use crate::options::Json;

/// Whose text is wanted.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Like {
    /// That of the `prettier` which `eslint-plugin-prettier` would load: `prettier/prettier`. It has to be a version whose
    /// output `bun format` follows.
    InstalledPrettier,
    /// That of `bun format`, whatever is installed: `bun/format`.
    BunFormat,
}

pub struct Request<'r> {
    pub like: Like,
    /// ESLint's `physicalFilename`.
    pub path_on_disk: &'r [u8],
    /// ESLint's `filename`: something else than `path_on_disk` for a block that a processor has found in the file.
    pub path: &'r [u8],
    /// Without a byte order mark.
    pub text: &'r [u8],
    /// Options of Prettier, which win over those of its configuration.
    pub options: Option<&'r Json>,
    /// `usePrettierrc`: whether the configuration of Prettier counts.
    pub uses_configuration: bool,
    /// `fileInfoOptions`: options for `prettier.getFileInfo()`.
    pub file_info_options: Option<&'r Json>,
}

/// Why the text would not be that of the package.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Reason {
    /// The `prettier` that is installed is not of a version that `bun format` follows, or none is to be found.
    Version,
    /// `eslint-plugin-prettier` is of a version that decides otherwise what is formatted and how.
    VersionOfPlugin,
    /// A plugin of Prettier that is not built in may print the file.
    Plugin,
    /// `bun format` does not print the language itself.
    Language,
    /// An option that `bun format` does not know.
    Option,
    /// The configuration cannot be read.
    Configuration,
    /// `bun format` finds a syntax error, whose words are not Prettier's.
    SyntaxError,
    /// `bun format` does not stand by what it has printed.
    Refused,
    /// [`File::formatter`] is `None`.
    NoFormatter,
}

impl Reason {
    /// What follows "the rule ran in JavaScript for 12 files: ".
    pub fn text(self) -> &'static str {
        match self {
            Reason::Version => {
                "the prettier that is installed is not 3.9, which bun format follows"
            }
            Reason::VersionOfPlugin => "the eslint-plugin-prettier that is installed is not 5",
            Reason::Plugin => "a plugin of Prettier that bun format does not have may print them",
            Reason::Language => "bun format does not print their language itself",
            Reason::Option => "bun format does not know one of the options",
            Reason::Configuration => "the configuration of Prettier cannot be read",
            Reason::SyntaxError => "bun format finds a syntax error in them",
            Reason::Refused => "bun format does not stand by what it has printed",
            Reason::NoFormatter => "there is no formatter",
        }
    }
}

pub enum Formatted {
    /// It is formatted.
    Same,
    Text(Vec<u8>),
    /// Prettier ignores the file, or the plugin leaves it alone: there is nothing to report.
    Skipped,
    NotNative(Reason),
}

pub trait Formats: Sync {
    fn formatted(&self, request: &Request) -> Formatted;
}

/// The formatter, for one file.
#[derive(Copy, Clone)]
pub struct Formatter<'a> {
    pub formats: &'a dyn Formats,
    /// See [`Request::path_on_disk`].
    pub path_on_disk: &'a [u8],
}

impl<'a> File<'a> {
    /// `None` where nobody provides one.
    #[inline]
    pub fn formatter(&self) -> Option<Formatter<'a>> {
        self.formatter.get()
    }

    /// `physical_path_len`: how much of the path of the file is that of the file on disk, if not all of it.
    pub fn set_formatter(&self, formats: &'a dyn Formats, physical_path_len: Option<usize>) {
        let path = self.path();
        let path_on_disk = physical_path_len
            .and_then(|it| path.get(..it))
            .unwrap_or(path);
        self.formatter.set(Some(Formatter {
            formats,
            path_on_disk,
        }));
    }

    /// The rule that stands in for that of a package has nothing to say about the file: the rule of the package is asked.
    pub fn hand_back(&self, reason: Reason) {
        self.handed_back.set(Some(reason));
    }

    pub fn handed_back(&self) -> Option<Reason> {
        self.handed_back.get()
    }
}
