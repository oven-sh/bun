//! Node-shaped module-resolution failure info captured by the resolver for the
//! runtime to surface as Node's exact `ERR_*` errors when a resolve fails.
//! Message templates: https://github.com/nodejs/node/blob/main/lib/internal/errors.js

use std::io::Write as _;

use bstr::BStr;

/// Which Node error the capture maps to. The JS-visible `code` also depends
/// on the import kind (`require()` spells module-not-found `MODULE_NOT_FOUND`;
/// ESM spells it `ERR_MODULE_NOT_FOUND`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeModuleErrorKind {
    InvalidPackageJson,
    /// ERR_PACKAGE_PATH_NOT_EXPORTED
    PackagePathNotExported,
    /// ERR_PACKAGE_IMPORT_NOT_DEFINED
    PackageImportNotDefined,
    /// ERR_INVALID_PACKAGE_TARGET
    InvalidPackageTarget,
    /// ERR_INVALID_PACKAGE_CONFIG — unparseable package.json. The referrer
    /// clause is ` while importing "<specifier>" from <referrer>` and the
    /// message ends with a period.
    InvalidPackageConfig,
    /// ERR_INVALID_PACKAGE_CONFIG — parseable package.json with an invalid
    /// `exports`/`imports` shape. The referrer clause is
    /// ` while importing <referrer-as-file-url>`.
    InvalidPackageConfigStructure,
}

/// A captured failure. `head` is Node's message with the referrer clause
/// omitted; the clause (whose shape depends on `kind` and the import kind) is
/// inserted at byte offset `insert_at` once the referrer is known.
pub struct NodeModuleError {
    pub kind: NodeModuleErrorKind,
    pub json_message: Box<[u16]>,
    pub head: Vec<u8>,
    pub insert_at: usize,
    /// Node includes the referrer clause for `require()` of `#imports`
    /// specifiers but not for `require()` of package `exports`.
    pub referrer_in_require: bool,
    pub suppress_referrer: bool,
    pub specifier_override: Option<Box<[u8]>>,
    pub referrer_override: Option<Box<[u8]>>,
}

/// JSON-stringify `target` the way Node's `JSONStringify(target)` renders a
/// string target in ERR_INVALID_PACKAGE_TARGET.
fn write_json_string(out: &mut Vec<u8>, s: &[u8]) {
    let start = out.len();
    let _ = write!(
        out,
        "{}",
        bun_core::fmt::format_json_string_utf8(s, Default::default())
    );
    // JSON.stringify uses lowercase escapes and literal Unicode separators.
    let end = out.len();
    let (mut read, mut write) = (start, start);
    while let Some(offset) = bun_core::strings::index_of_char_usize(&out[read..end], b'\\') {
        out.copy_within(read..read + offset, write);
        read += offset;
        write += offset;
        if read + 6 <= end && out[read + 1] == b'u' {
            out[read + 2..read + 6].make_ascii_lowercase();
            let literal = match &out[read + 2..read + 6] {
                b"2028" => Some("\u{2028}"),
                b"2029" => Some("\u{2029}"),
                b"feff" => Some("\u{feff}"),
                _ => None,
            };
            if let Some(literal) = literal {
                let bytes = literal.as_bytes();
                out[write..write + bytes.len()].copy_from_slice(bytes);
                write += bytes.len();
            } else {
                out.copy_within(read..read + 6, write);
                write += 6;
            }
            read += 6;
        } else {
            out.copy_within(read..read + 2, write);
            read += 2;
            write += 2;
        }
    }
    out.copy_within(read..end, write);
    out.truncate(write + end - read);
}

impl NodeModuleError {
    pub fn package_config_for_import(
        path: &[u8],
        reason: crate::package_json::PackageConfigError,
        specifier: &[u8],
        imports_referrer: Option<&[u8]>,
    ) -> Box<Self> {
        let mut error = Self::package_config(path, reason);
        if matches!(reason, crate::package_json::PackageConfigError::Invalid) {
            error.suppress_referrer = false;
            if let Some(referrer) = imports_referrer {
                error.referrer_in_require = true;
                error.specifier_override = Some(Box::from(specifier));
                error.referrer_override = Some(Box::from(referrer));
            }
        }
        error
    }

    pub fn package_config(
        path: &[u8],
        reason: crate::package_json::PackageConfigError,
    ) -> Box<Self> {
        let mut error = Self::invalid_package_config(path);
        error.suppress_referrer = true;
        if let crate::package_json::PackageConfigError::Read(errno) = reason {
            let label = bun_sys::Error::new(errno, bun_sys::Tag::read)
                .uv_code_label()
                .map_or("unknown error", |(_, label)| label);
            error.head =
                format!("Cannot read package config {}: {label}.", BStr::new(path)).into_bytes();
            error.insert_at = error.head.len();
        }
        error
    }

    pub fn invalid_json(message: &[u16]) -> Box<Self> {
        let mut error = Self::at_end(NodeModuleErrorKind::InvalidPackageJson, Vec::new(), false);
        error.json_message = Box::from(message);
        error.suppress_referrer = true;
        error
    }

    pub fn is_fatal(&self) -> bool {
        matches!(
            self.kind,
            NodeModuleErrorKind::InvalidPackageConfig
                | NodeModuleErrorKind::InvalidPackageConfigStructure
                | NodeModuleErrorKind::InvalidPackageJson
        )
    }

    pub fn message(&self, is_esm: bool, specifier: &[u8], referrer: &[u8]) -> Vec<u8> {
        let specifier = self.specifier_override.as_deref().unwrap_or(specifier);
        let referrer = self.referrer_override.as_deref().unwrap_or(referrer);
        let mut text = Vec::with_capacity(self.head.len() + referrer.len() + 32);
        text.extend_from_slice(&self.head[..self.insert_at]);
        if !self.suppress_referrer
            && !referrer.is_empty()
            && referrer != b"bun:main"
            && (is_esm || self.referrer_in_require)
        {
            match self.kind {
                NodeModuleErrorKind::InvalidPackageConfig => {
                    let _ = write!(
                        text,
                        " while importing \"{}\" from {}",
                        BStr::new(specifier),
                        BStr::new(referrer)
                    );
                }
                NodeModuleErrorKind::InvalidPackageConfigStructure => {
                    let url =
                        bun_url::file_url_from_string(&bun_core::String::from_bytes(referrer));
                    let url = url.to_utf8();
                    let _ = write!(text, " while importing {}", BStr::new(url.slice()));
                }
                _ => {
                    let _ = write!(text, " imported from {}", BStr::new(referrer));
                }
            }
        }
        text.extend_from_slice(&self.head[self.insert_at..]);
        text
    }

    fn at_end(kind: NodeModuleErrorKind, head: Vec<u8>, referrer_in_require: bool) -> Box<Self> {
        let insert_at = head.len();
        Box::new(Self {
            kind,
            json_message: Box::default(),
            head,
            insert_at,
            referrer_in_require,
            suppress_referrer: false,
            specifier_override: None,
            referrer_override: None,
        })
    }

    /// `Package subpath './x' is not defined by "exports" in <pkg>/package.json`
    /// / `No "exports" main defined in <pkg>/package.json`
    pub fn package_path_not_exported(pkg_json_path: &[u8], subpath: &[u8]) -> Box<Self> {
        let mut head = Vec::new();
        if subpath == b"." {
            let _ = write!(
                head,
                "No \"exports\" main defined in {}",
                BStr::new(pkg_json_path)
            );
        } else {
            let _ = write!(
                head,
                "Package subpath '{}' is not defined by \"exports\" in {}",
                BStr::new(subpath),
                BStr::new(pkg_json_path)
            );
        }
        Self::at_end(NodeModuleErrorKind::PackagePathNotExported, head, false)
    }

    /// `Package import specifier "#x" is not defined in package <pkg>/package.json`
    pub fn package_import_not_defined(specifier: &[u8], pkg_json_path: &[u8]) -> Box<Self> {
        let mut head = Vec::new();
        let _ = write!(
            head,
            "Package import specifier \"{}\" is not defined in package {}",
            BStr::new(specifier),
            BStr::new(pkg_json_path)
        );
        Self::at_end(NodeModuleErrorKind::PackageImportNotDefined, head, true)
    }

    /// `Invalid "exports" [main ]target <target> defined [for '<key>' ]in the
    /// package config <pkg>/package.json[; targets must start with "./"]`
    pub fn invalid_package_target(
        pkg_json_path: &[u8],
        key: Option<&[u8]>,
        target: Option<&[u8]>,
        is_imports: bool,
        bare_string_target: bool,
    ) -> Box<Self> {
        let field: &str = if is_imports { "imports" } else { "exports" };
        let mut head = Vec::new();
        let _ = write!(head, "Invalid \"{field}\" ");
        match key {
            Some(b".") | None => {
                head.extend_from_slice(b"main target ");
                if let Some(target) = target {
                    write_json_string(&mut head, target);
                }
                let _ = write!(
                    head,
                    " defined in the package config {}",
                    BStr::new(pkg_json_path)
                );
            }
            Some(key) => {
                head.extend_from_slice(b"target ");
                if let Some(target) = target {
                    write_json_string(&mut head, target);
                }
                let _ = write!(
                    head,
                    " defined for '{}' in the package config {}",
                    BStr::new(key),
                    BStr::new(pkg_json_path)
                );
            }
        }
        let insert_at = head.len();
        // Node's `relError` clause is exports-only.
        if bare_string_target && !is_imports {
            head.extend_from_slice(b"; targets must start with \"./\"");
        }
        Box::new(Self {
            kind: NodeModuleErrorKind::InvalidPackageTarget,
            json_message: Box::default(),
            head,
            insert_at,
            referrer_in_require: is_imports,
            suppress_referrer: false,
            specifier_override: None,
            referrer_override: None,
        })
    }

    /// `Invalid package config <pkg>/package.json.` (unparseable file; the
    /// period trails the referrer clause).
    pub fn invalid_package_config(pkg_json_path: &[u8]) -> Box<Self> {
        let mut head = Vec::new();
        let _ = write!(head, "Invalid package config {}", BStr::new(pkg_json_path));
        let insert_at = head.len();
        head.push(b'.');
        Box::new(Self {
            kind: NodeModuleErrorKind::InvalidPackageConfig,
            json_message: Box::default(),
            head,
            insert_at,
            referrer_in_require: false,
            suppress_referrer: false,
            specifier_override: None,
            referrer_override: None,
        })
    }

    /// `Invalid package config <pkg>/package.json. <message>` (invalid
    /// `exports`/`imports` shape).
    pub fn invalid_package_config_structure(
        pkg_json_path: &[u8],
        message: Option<&[u8]>,
    ) -> Box<Self> {
        let mut head = Vec::new();
        let _ = write!(head, "Invalid package config {}", BStr::new(pkg_json_path));
        let insert_at = head.len();
        if let Some(message) = message {
            let _ = write!(head, ". {}", BStr::new(message));
        }
        Box::new(Self {
            kind: NodeModuleErrorKind::InvalidPackageConfigStructure,
            json_message: Box::default(),
            head,
            insert_at,
            referrer_in_require: false,
            suppress_referrer: false,
            specifier_override: None,
            referrer_override: None,
        })
    }
}
