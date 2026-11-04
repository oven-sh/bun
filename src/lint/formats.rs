//! The formatter interface for rules that compare a file with its formatted text.
//!
//! The printers, and the code that finds a file's Prettier config, live in crates above this one. The caller that lints
//! the files provides them through [`File::formatter`].
//!
//! A native rule only replaces a package's rule where its text is byte for byte what the package would produce.
//! [`Formats`] reports for each file if that isn't the case, with [`Formatted::NotNative`]. The rule then reports
//! nothing and [hands the file back](File::hand_back), and the package's rule checks it instead.

use crate::ast::File;
use crate::options::Json;
use std::sync::Arc;

/// Selects the formatter whose output is produced.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FormatterKind {
    /// The output of the `prettier` that `eslint-plugin-prettier` would load, for `prettier/prettier`. It has to be a
    /// version whose output `bun fmt` matches.
    InstalledPrettier,
    /// The output of `bun fmt`, whatever is installed, for `bun/format`.
    BunFormat,
}

pub struct Request<'r> {
    pub formatter_kind: FormatterKind,
    /// ESLint's `physicalFilename`.
    pub path_on_disk: &'r [u8],
    /// ESLint's `filename`. It differs from `path_on_disk` for a block that a processor extracted from the file.
    pub path: &'r [u8],
    /// Without a byte order mark.
    pub text: &'r [u8],
    /// Prettier options, which override the ones in its config.
    pub options: Option<&'r Json>,
    /// `usePrettierrc`: true if Prettier's config is used.
    pub uses_configuration: bool,
    /// `fileInfoOptions`: options for `prettier.getFileInfo()`.
    pub file_info_options: Option<&'r Json>,
    /// [`File::package_module`]
    pub package_module: Option<&'r [u8]>,
    /// Only used with [`FormatterKind::InstalledPrettier`]. If set, the output has to match the installed packages, so
    /// their versions are checked. Otherwise nothing has to be installed.
    pub follows_packages: bool,
}

/// Why the output wouldn't match the package's.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Reason {
    /// The installed `prettier` isn't a version that `bun fmt` matches, or none was found.
    Version,
    /// The installed `eslint-plugin-prettier` is a version that decides differently what's formatted and how.
    PluginVersion,
    /// `eslint-plugin-prettier` wasn't found, so its version is unknown.
    PluginNotFound,
    /// A Prettier plugin that isn't built in may print the file.
    Plugin,
    /// `bun fmt` doesn't have its own printer for the language.
    Language,
    /// An option that `bun fmt` doesn't support.
    Option,
    /// The config can't be read.
    Configuration,
    /// `bun fmt` found a syntax error, and its message differs from Prettier's.
    SyntaxError,
    /// `bun fmt` couldn't verify its own output.
    Unverified,
    /// `sortTailwindcss` is on, and Tailwind CSS hasn't been queried about one of the classes.
    Classes,
    /// [`File::formatter`] is `None`.
    NoFormatter,
}

impl Reason {
    /// Completes the sentence "the rule ran in JavaScript for 12 files because ..".
    pub fn text(self) -> &'static str {
        match self {
            Reason::Version => "the installed prettier is not version 3.9, which bun fmt matches",
            Reason::PluginVersion => "the installed eslint-plugin-prettier is not version 5",
            Reason::PluginNotFound => "eslint-plugin-prettier was not found",
            Reason::Plugin => "the Prettier config uses a plugin that bun fmt does not include",
            Reason::Language => "bun fmt does not support the language",
            Reason::Option => "bun fmt does not support one of the options",
            Reason::Configuration => "the Prettier config cannot be read",
            Reason::SyntaxError => "bun fmt found a syntax error",
            Reason::Unverified => "bun fmt could not verify its output",
            Reason::Classes => "only bun fmt can sort Tailwind CSS classes",
            Reason::NoFormatter => "there is no formatter",
        }
    }
}

pub enum Formatted {
    /// The file is already formatted.
    Same,
    Text(Vec<u8>),
    /// Prettier ignores the file, or the plugin skips it, so there's nothing to report.
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
    /// `None` if the caller didn't provide one.
    #[inline]
    pub fn formatter(&self) -> Option<Formatter<'a>> {
        self.formatter.get()
    }

    /// `physical_path_len` is the length of the prefix of the file's path that's the path on disk, or `None` if the
    /// whole path is.
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

    /// Called by a native rule that replaces a package's rule when it can't handle the file. The package's rule runs on
    /// the file instead.
    pub fn hand_back(&self, reason: Reason) {
        self.handed_back.set(Some(reason));
    }

    pub fn handed_back(&self) -> Option<Reason> {
        self.handed_back.get()
    }

    /// Returns the path of the module that the config loaded the package's plugin from, if known. That copy's version
    /// is the one that counts, along with the `prettier` that resolves from there. A package manager can install both
    /// where they can't be resolved from the working directory.
    pub fn package_module(&self) -> Option<&[u8]> {
        self.package_module.get().map(|it| &**it)
    }

    /// Only the first call has an effect.
    pub fn set_package_module(&self, module: Arc<[u8]>) {
        let _ = self.package_module.set(module);
    }
}
