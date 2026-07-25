//! Node-shaped module-resolution failure info, captured by the resolver as it
//! walks `exports` / `imports` maps and consumed by the runtime's resolve
//! hooks to produce Node's exact `ERR_*` module errors. The capture is
//! advisory: it never changes the resolution outcome, and is only read when
//! the overall resolve fails.
//!
//! Message templates: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js
//! (`ERR_PACKAGE_PATH_NOT_EXPORTED`, `ERR_PACKAGE_IMPORT_NOT_DEFINED`,
//! `ERR_INVALID_PACKAGE_TARGET`, `ERR_INVALID_PACKAGE_CONFIG`,
//! `ERR_INVALID_MODULE_SPECIFIER`, `ERR_MODULE_NOT_FOUND`,
//! `ERR_UNSUPPORTED_DIR_IMPORT`).

use std::io::Write as _;

use bstr::BStr;

/// Which Node error the capture maps to. The JS-visible `code` also depends
/// on the import kind (`require()` spells module-not-found `MODULE_NOT_FOUND`;
/// ESM spells it `ERR_MODULE_NOT_FOUND`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeModuleErrorKind {
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
    /// ERR_INVALID_MODULE_SPECIFIER
    InvalidModuleSpecifier,
    /// MODULE_NOT_FOUND / ERR_MODULE_NOT_FOUND with the exports-resolved
    /// filesystem path in the message.
    ModuleNotFound,
    /// ERR_UNSUPPORTED_DIR_IMPORT
    UnsupportedDirImport,
}

/// A captured failure. `head` is Node's message with the referrer clause
/// omitted; the clause (whose shape depends on `kind` and the import kind) is
/// inserted at byte offset `insert_at` once the referrer is known.
pub struct NodeModuleError {
    pub kind: NodeModuleErrorKind,
    pub head: Vec<u8>,
    pub insert_at: usize,
    /// Node includes the referrer clause for `require()` of `#imports`
    /// specifiers but not for `require()` of package `exports`.
    pub referrer_in_require: bool,
}

/// JSON-stringify `target` the way Node's `JSONStringify(target)` renders a
/// string target in ERR_INVALID_PACKAGE_TARGET.
fn write_json_string(out: &mut Vec<u8>, s: &[u8]) {
    out.push(b'"');
    for &b in s {
        match b {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            _ => out.push(b),
        }
    }
    out.push(b'"');
}

impl NodeModuleError {
    fn at_end(kind: NodeModuleErrorKind, head: Vec<u8>, referrer_in_require: bool) -> Box<Self> {
        let insert_at = head.len();
        Box::new(Self {
            kind,
            head,
            insert_at,
            referrer_in_require,
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
            head,
            insert_at,
            referrer_in_require: is_imports,
        })
    }

    /// `Invalid module "<request>" <reason>`
    pub fn invalid_module_specifier(
        request: &[u8],
        reason: core::fmt::Arguments<'_>,
        referrer_in_require: bool,
    ) -> Box<Self> {
        let mut head = Vec::new();
        let _ = write!(head, "Invalid module \"{}\" {}", BStr::new(request), reason);
        Self::at_end(
            NodeModuleErrorKind::InvalidModuleSpecifier,
            head,
            referrer_in_require,
        )
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
            head,
            insert_at,
            referrer_in_require: false,
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
            head,
            insert_at,
            referrer_in_require: false,
        })
    }

    /// `Cannot find module '<abs path>'` (exports/imports-resolved target
    /// file that doesn't exist).
    pub fn module_not_found(path: &[u8]) -> Box<Self> {
        let mut head = Vec::new();
        let _ = write!(head, "Cannot find module '{}'", BStr::new(path));
        Self::at_end(NodeModuleErrorKind::ModuleNotFound, head, false)
    }

    /// `Directory import '<abs path>' is not supported resolving ES modules`
    pub fn unsupported_dir_import(path: &[u8]) -> Box<Self> {
        let mut head = Vec::new();
        let _ = write!(
            head,
            "Directory import '{}' is not supported resolving ES modules",
            BStr::new(path)
        );
        Self::at_end(NodeModuleErrorKind::UnsupportedDirImport, head, false)
    }
}
