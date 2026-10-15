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
use std::sync::Arc;

/// Whose text is wanted.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Like {
    /// That of the `prettier` which `eslint-plugin-prettier` would load: `prettier/prettier`. It has to be a version whose
    /// output `bun fmt` follows.
    InstalledPrettier,
    /// That of `bun fmt`, whatever is installed: `bun/format`.
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
    /// [`File::package_module`]
    pub package_module: Option<&'r [u8]>,
    /// Only used with [`Like::InstalledPrettier`]. If set, the output has to match the installed packages, so their versions
    /// are checked. Otherwise nothing has to be installed.
    pub follows_packages: bool,
}

/// Why the text would not be that of the package.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Reason {
    /// The `prettier` that is installed is not of a version that `bun fmt` follows, or none is to be found.
    Version,
    /// `eslint-plugin-prettier` is of a version that decides otherwise what is formatted and how.
    VersionOfPlugin,
    /// `eslint-plugin-prettier` is not to be found, so that nothing is known of its version.
    PluginNotFound,
    /// A plugin of Prettier that is not built in may print the file.
    Plugin,
    /// `bun fmt` does not print the language itself.
    Language,
    /// An option that `bun fmt` does not know.
    Option,
    /// The configuration cannot be read.
    Configuration,
    /// `bun fmt` finds a syntax error, whose words are not Prettier's.
    SyntaxError,
    /// `bun fmt` does not stand by what it has printed.
    Refused,
    /// `sortTailwindcss`, and a class that Tailwind CSS has not been asked about.
    Classes,
    /// [`File::formatter`] is `None`.
    NoFormatter,
}

impl Reason {
    /// Completes the sentence "the rule ran in JavaScript for 12 files because ..".
    pub fn text(self) -> &'static str {
        match self {
            Reason::Version => "the installed prettier is not version 3.9, which bun fmt matches",
            Reason::VersionOfPlugin => "the installed eslint-plugin-prettier is not version 5",
            Reason::PluginNotFound => "eslint-plugin-prettier was not found",
            Reason::Plugin => "the Prettier config uses a plugin that bun fmt does not include",
            Reason::Language => "bun fmt does not support the language",
            Reason::Option => "bun fmt does not support one of the options",
            Reason::Configuration => "the Prettier config cannot be read",
            Reason::SyntaxError => "bun fmt found a syntax error",
            Reason::Refused => "bun fmt could not verify its output",
            Reason::Classes => "only bun fmt can sort Tailwind CSS classes",
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

    /// The file of the module that the configuration has loaded the plugin of the package from, if that is known. It is that
    /// copy whose version counts, and the `prettier` that is found from there: a package manager can keep both out of reach
    /// of the working directory.
    pub fn package_module(&self) -> Option<&[u8]> {
        self.package_module.get().map(|it| &**it)
    }

    /// The first time counts.
    pub fn set_package_module(&self, module: Arc<[u8]>) {
        let _ = self.package_module.set(module);
    }
}
