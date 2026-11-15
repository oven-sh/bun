// This file is the old linker, used by Bun.Transpiler.

use std::sync::LazyLock;

use bun_alloc::BSSStringList;
use bun_ast::Log;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, ImportRecordTag};
use bun_paths::{self, SEP};
// two `fs` shapes are in play here. `bun_resolver::fs` (`Fs`) holds
// the singleton `FileSystem` / `DirnameStore`; `bun_paths::fs` (`PFs`) defines
// the `Path`/`PathName` value types that `ImportRecord.path` is typed against.
// B-3 collapses them. Until then, construct
// `import_record.path` via `PFs::Path` so the field assignment unifies.
use bun_core::strings;
use bun_paths::fs as PFs;
use bun_resolver as resolver;
use bun_resolver::fs as Fs;
use bun_sys::Fd;
use bun_url::URL;

use crate::options::{self, BundleOptions, ImportPathFormat};
use crate::options_impl::Target as BundleTarget;
use crate::transpiler::{ParseResult, ResolveQueue, ResolveResults};

const RUNTIME_SOURCE_PATH: &[u8] = b"bun:wrap";

static RELATIVE_PATHS_LIST: LazyLock<BSSStringList> =
    LazyLock::new(|| BSSStringList::new(512 * 2 * (128 + 1)));

// ── HardcodedModule alias lookup ────────────────────────────────────────
// Thin adapter over `bun_resolve_builtins::Alias::get` so the call site keeps
// `&'static [u8]` for `import_record.path.text` (the table stores `&'static
// ZStr`). `BundleTarget` and `bun_resolve_builtins::Target` are the same
// `bun_ast::Target`; ditto `ImportRecordTag` /
// `import_record::Tag`, so no bridge is needed.
mod hardcoded_module {
    use super::*;
    #[derive(Default, Clone, Copy)]
    pub(super) struct AliasOptions {
        pub rewrite_jest_for_tests: bool,
    }
    pub(super) struct Alias {
        pub path: &'static [u8],
        pub tag: ImportRecordTag,
    }
    pub(super) fn get(name: &[u8], target: BundleTarget, opts: AliasOptions) -> Option<Alias> {
        bun_resolve_builtins::Alias::get(
            name,
            target,
            bun_resolve_builtins::Cfg {
                rewrite_jest_for_tests: opts.rewrite_jest_for_tests,
            },
        )
        .map(|a| Alias {
            path: a.path.as_bytes(),
            tag: a.tag,
        })
    }
}

/// Intern a byte buffer into the process-lifetime `RELATIVE_PATHS_LIST`
/// `BSSStringList` singleton.
#[inline]
pub(crate) fn dupe(src: &[u8]) -> &'static [u8] {
    bun_core::handle_oom(RELATIVE_PATHS_LIST.append(src))
}

fn get_mod_key(file_path: &PFs::Path<'_>, fd: Option<Fd>) -> crate::Result<Fs::ModKey> {
    // Borrow the cached fd; own the freshly-opened one.
    let _owned: Option<bun_sys::File>;
    let raw_fd = match fd {
        Some(f) => {
            _owned = None;
            f
        }
        None => {
            let f = bun_sys::open_file(file_path.text, bun_sys::OpenFlags::READ_ONLY)?;
            let raw = f.handle();
            _owned = Some(f);
            raw
        }
    };
    let file = bun_sys::File::borrow(&raw_fd);
    Fs::FileSystem::set_max_fd(file.handle().native());
    Ok(Fs::ModKey::from_file(file)?)
}

pub(crate) fn get_hashed_filename(
    file_path: &PFs::Path<'_>,
    fd: Option<Fd>,
) -> crate::Result<&'static [u8]> {
    let modkey = get_mod_key(file_path, fd)?;
    let mut hash_name_buf = [0u8; 1024];
    Ok(dupe(modkey.hash_name(file_path.text, &mut hash_name_buf)?))
}

/// Rewrites the import records of builtins and of the runtime in place.
pub fn link<const IGNORE_RUNTIME: bool, const IS_BUN: bool>(
    log: &Log,
    options: &BundleOptions<'_>,
    file_path: &Fs::Path<'_>,
    result: &mut ParseResult,
    origin: &URL<'_>,
    import_path_format: ImportPathFormat,
) -> crate::Result<()> {
    let (target, rewrite_jest_for_tests) = (options.target, options.rewrite_jest_for_tests);

    let source_dir = file_path.source_dir();

    match result.loader {
        options::Loader::Jsx | options::Loader::Js | options::Loader::Ts | options::Loader::Tsx => {
            let source = &result.source;
            for import_record in result.ast.import_records.as_mut_slice() {
                if import_record.flags.contains(ImportRecordFlags::IS_UNUSED) {
                    continue;
                }

                if !IGNORE_RUNTIME {
                    if import_record.path.namespace == b"runtime" {
                        let relative_name =
                            bun_paths::resolve_path::relative(source_dir, RUNTIME_SOURCE_PATH);
                        import_record.path = match import_path_format {
                            ImportPathFormat::AbsoluteUrl => PFs::Path::init_with_namespace(
                                dupe(&origin.join_alloc(b"", b"", b"bun:wrap", b"", b"")?),
                                b"bun",
                            ),
                            ImportPathFormat::AbsolutePath => PFs::Path::init_with_pretty(
                                RUNTIME_SOURCE_PATH,
                                dupe(relative_name),
                            ),
                            ImportPathFormat::Relative => {
                                let text = if relative_name.len() > 1
                                    && !(relative_name[0] == SEP || relative_name[0] == b'.')
                                {
                                    dupe(&strings::concat(&[b"./", relative_name]))
                                } else {
                                    dupe(relative_name)
                                };
                                PFs::Path::init_with_pretty(text, text)
                            }
                            ImportPathFormat::PackagePath => unreachable!(),
                        };
                        continue;
                    }
                }

                if IS_BUN {
                    if let Some(replacement) = hardcoded_module::get(
                        import_record.path.text,
                        target,
                        hardcoded_module::AliasOptions {
                            rewrite_jest_for_tests,
                        },
                    ) {
                        if replacement.tag == ImportRecordTag::Builtin
                            && import_record.kind.is_common_js()
                        {
                            continue;
                        }
                        import_record.path.text = replacement.path;
                        import_record.tag = replacement.tag;
                        import_record
                            .flags
                            .insert(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                        continue;
                    }
                    if strings::starts_with(import_record.path.text, b"node:") {
                        // if a module is not found here, it is not found at all so we can just disable it
                        if when_module_not_found::<IS_BUN>(log, target, import_record, source)? {
                            return Err(crate::Error::ResolveMessage);
                        }
                        continue;
                    }

                    if let Some(builtin) =
                        bun_resolve_builtins::Alias::bun_prefixed_builtin(import_record.path.text)
                    {
                        import_record.path = PFs::Path::init(builtin);
                    }
                }
            }
        }

        _ => {}
    }
    Ok(())
}

fn when_module_not_found<const IS_BUN: bool>(
    log: &Log,
    target: BundleTarget,
    import_record: &mut ImportRecord,
    source: &bun_ast::Source,
) -> crate::Result<bool> {
    if import_record
        .flags
        .contains(ImportRecordFlags::HANDLES_IMPORT_ERRORS)
    {
        import_record.path.is_disabled = true;
        import_record
            .flags
            .insert(ImportRecordFlags::WAS_UNRESOLVED);
        return Ok(false);
    }

    if IS_BUN {
        // make these happen at runtime
        if import_record.kind == ImportKind::Require
            || import_record.kind == ImportKind::RequireResolve
            || import_record.kind == ImportKind::Dynamic
        {
            return Ok(false);
        }
    }

    if !import_record.path.text.is_empty() && resolver::is_package_path(import_record.path.text) {
        if target == BundleTarget::Browser && options::is_node_builtin(import_record.path.text) {
            log.add_resolve_error(
                Some(source),
                import_record.range,
                format_args!(
                    "Could not resolve: \"{}\". Try setting --target=\"node\"",
                    bstr::BStr::new(import_record.path.text)
                ),
                import_record.path.text,
                import_record.kind,
                bun_ast::Error::ModuleNotFound,
            );
        } else {
            log.add_resolve_error(
                Some(source),
                import_record.range,
                format_args!(
                    "Could not resolve: \"{}\". Maybe you need to \"bun install\"?",
                    bstr::BStr::new(import_record.path.text)
                ),
                import_record.path.text,
                import_record.kind,
                bun_ast::Error::ModuleNotFound,
            );
        }
    } else {
        log.add_resolve_error(
            Some(source),
            import_record.range,
            format_args!(
                "Could not resolve: \"{}\"",
                bstr::BStr::new(import_record.path.text)
            ),
            import_record.path.text,
            import_record.kind,
            bun_ast::Error::ModuleNotFound,
        );
    }
    Ok(true)
}

fn resolve_result_hash_key(resolve_result: &resolver::Result) -> u64 {
    let path = resolve_result.path_const().expect("unreachable");
    let top_level_dir = Fs::FileSystem::get().top_level_dir();
    let mut hash_key = path.text;

    // Shorter hash key is faster to hash
    if strings::starts_with(path.text, top_level_dir) {
        hash_key = &path.text[top_level_dir.len()..];
    }

    bun_wyhash::hash(hash_key)
}

pub(crate) fn enqueue_resolve_result(
    resolve_results: &mut ResolveResults,
    resolve_queue: &mut ResolveQueue,
    resolve_result: resolver::Result<'static>,
) -> crate::Result<bool> {
    let hash_key = resolve_result_hash_key(&resolve_result);

    // `found_existing` is whether the key was already present.
    let found_existing = resolve_results.contains_key(&hash_key);
    if !found_existing {
        resolve_results.insert(hash_key, ());
        resolve_queue.push_back(resolve_result);
    }

    Ok(!found_existing)
}
