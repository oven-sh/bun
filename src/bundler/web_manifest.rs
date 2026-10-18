//! Web app manifests (https://www.w3.org/TR/appmanifest/).
//!
//! A page names its manifest with `<link rel="manifest" href>`. The manifest names
//! image files, and a browser resolves each name against the manifest's own URL.
//! The bundler copies the manifest under a hashed name, so it also copies those
//! images and writes their new paths into the copy.
//!
//! Only a relative `src` that resolves to a file is followed. Every other byte of
//! the manifest stays as written, and nothing here fails a build.

use std::io::Write as _;

use bun_alloc::Arena;
use bun_ast::{Expr, ImportKind, ImportRecord, ImportRecordFlags, Source};
use bun_paths::resolve_path::{self, platform::Posix};

use crate::Graph::InputFileFlags;
use crate::bundle_v2::bv2_impl::{PatchImportRecordsCtx, ResolveImportRecordCtx};
use crate::bundle_v2::{BundleV2, ContentHasher};
use crate::mal_prelude::*;
use crate::options::{Loader, PathTemplate};
use crate::{Index, IndexInt, import_record};

/// Runs when no parse is pending: only then is the file that a page links loaded,
/// whichever importer or plugin created it. Gives each such file one `Url` record
/// per image it names. The parse tasks this schedules count in `pending_items`.
pub(crate) fn follow(this: &mut BundleV2) {
    if this.graph.pages_linking_web_manifest.is_empty() || this.graph.cancelled {
        return;
    }
    // The pages stay listed: a manifest whose `onLoad` awaits `defer()` loads later.
    let pages = core::mem::take(&mut this.graph.pages_linking_web_manifest);
    let mut scheduled: i32 = 0;
    for &page in &pages {
        // A page's records do not change here, but the column can move.
        for link in 0..this.graph.ast.items_import_records()[page as usize].len() as usize {
            let record = &this.graph.ast.items_import_records()[page as usize].as_slice()[link];
            if record.flags.contains(ImportRecordFlags::IS_WEB_MANIFEST)
                && record.source_index.is_valid()
            {
                scheduled += follow_one(this, record.source_index.get());
            }
        }
    }
    this.graph.pages_linking_web_manifest = pages;
    // Like the tasks that a barrel's records schedule, these bypass the scan counter.
    this.graph.pending_items += u32::try_from(scheduled).expect("int cast");
}

/// Resolves and schedules the records of `manifest` as `resolve_barrel_records` does.
fn follow_one(this: &mut BundleV2, manifest: IndexInt) -> i32 {
    let idx = manifest as usize;
    let input_files = &mut this.graph.input_files;
    // No unique key: the file is not copied, or an `onLoad` that awaits `defer()` still holds it.
    if input_files.items_loader()[idx] != Loader::File
        || input_files.items_unique_key_for_additional_file()[idx].is_empty()
        || input_files.items_flags()[idx].contains(InputFileFlags::IS_WEB_MANIFEST_FOLLOWED)
    {
        return 0;
    }
    input_files.items_flags_mut()[idx].insert(InputFileFlags::IS_WEB_MANIFEST_FOLLOWED);

    let heap = this.graph.heap;
    let target = this.graph.ast.items_target()[idx];
    // Moved out so the `&mut BundleV2` calls below do not alias a borrow into `graph.input_files`.
    let source = core::mem::take(&mut this.graph.input_files.items_source_mut()[idx]);
    let source_path: &'static [u8] = source.path.text;
    let mut records = bun_alloc::vec_from_iter_in(import_records(&source, heap), heap);

    let resolved = this.resolve_import_records(&mut ResolveImportRecordCtx {
        import_records: &mut records,
        source: &source,
        loader: Loader::File,
        target,
        only_records: None,
    });
    this.graph.input_files.items_source_mut()[idx] = source;

    let scheduled = this.process_resolve_queue(&resolved.resolve_queue, target, manifest);
    this.patch_import_record_source_indices(
        &mut records,
        PatchImportRecordsCtx {
            source_index: Index::init(manifest),
            source_path,
            loader: Loader::File,
            target,
            ..Default::default()
        },
    );
    this.graph.ast.items_import_records_mut()[idx] = records;
    scheduled
}

/// One record per relative `src` in `icons`, `screenshots`, and the `icons` of each
/// entry of `shortcuts` and `file_handlers`, in source order. A record's range is the
/// `src` string literal, which `with_paths` replaces.
fn import_records(source: &Source, heap: &Arena) -> Vec<ImportRecord> {
    let mut records: Vec<ImportRecord> = Vec::new();
    let Ok(root) = bun_parsers::json::parse_utf8(source, &mut bun_ast::Log::init(), heap) else {
        return records;
    };
    let bun_ast::expr::Data::EObject(root) = root.data else {
        return records;
    };

    let record = |src: Expr| -> Option<ImportRecord> {
        let text = src.as_utf8_string_literal()?;
        // Between the quotes. A `src` written with an escape stays as written.
        let start = usize::try_from(src.loc.start).ok()? + 1;
        let end = start + text.len();
        if !is_relative(text)
            || source.contents.get(start..end) != Some(text)
            || source.contents.get(end) != Some(&b'"')
        {
            return None;
        }
        // `./`: a bare name is a file beside the manifest, not a package.
        let path = heap.alloc_slice_fill_copy(text.len() + 2, b'.');
        path[1] = b'/';
        path[2..].copy_from_slice(text);
        // SAFETY: `heap` is the graph's arena. It outlives every use of the record.
        let path: &'static [u8] = unsafe { bun_ptr::detach_lifetime(path) };
        Some(ImportRecord {
            path: bun_paths::fs::Path::init(path),
            kind: ImportKind::Url,
            range: bun_ast::Range {
                loc: src.loc,
                len: i32::try_from(text.len() + 2).ok()?,
            },
            tag: Default::default(),
            loader: Some(Loader::File),
            source_index: Index::INVALID,
            original_path: &path[2..],
            // A `src` that names no file stays as written. It is not an error.
            flags: ImportRecordFlags::HANDLES_IMPORT_ERRORS,
        })
    };
    let mut add_images = |list: Expr| {
        let Some(mut images) = list.as_array() else {
            return;
        };
        while let Some(image) = images.next() {
            records.extend(image.get(b"src").and_then(&record));
        }
    };

    for property in root.properties.iter() {
        let (Some(key), Some(value)) = (&property.key, property.value) else {
            continue;
        };
        match key.as_utf8_string_literal() {
            Some(b"icons" | b"screenshots") => add_images(value),
            Some(b"shortcuts" | b"file_handlers") => {
                let Some(mut entries) = value.as_array() else {
                    continue;
                };
                while let Some(entry) = entries.next() {
                    if let Some(icons) = entry.get(b"icons") {
                        add_images(icons);
                    }
                }
            }
            _ => {}
        }
    }
    debug_assert!(records.is_sorted_by_key(|record| record.range.loc.start));
    records
}

/// Not empty, not root-absolute or protocol-relative (`/...`), and no URL scheme.
fn is_relative(src: &[u8]) -> bool {
    let Some(&first) = src.first() else {
        return false;
    };
    // A URL parser reads `\` as `/`.
    if first == b'/' || first == b'\\' {
        return false;
    }
    let scheme_len = src
        .iter()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
        .count();
    !(first.is_ascii_alphabetic() && src.get(scheme_len) == Some(&b':'))
}

/// Runs once every file is loaded. A record stands only if its target is a copied
/// file: an `onLoad` plugin or another importer can make the target a module, and a
/// page can link it as a manifest of its own. That `src` stays as written.
pub(crate) fn keep_copied_files(this: &mut BundleV2) {
    let graph = &mut this.graph;
    let loaders = graph.input_files.items_loader();
    let flags = graph.input_files.items_flags();
    for &page in &graph.pages_linking_web_manifest {
        for link in 0..graph.ast.items_import_records()[page as usize].len() as usize {
            let link = &graph.ast.items_import_records()[page as usize].as_slice()[link];
            if !link.flags.contains(ImportRecordFlags::IS_WEB_MANIFEST)
                || !link.source_index.is_valid()
            {
                continue;
            }
            let manifest = link.source_index.get() as usize;
            if !flags[manifest].contains(InputFileFlags::IS_WEB_MANIFEST_FOLLOWED) {
                continue;
            }
            for record in graph.ast.items_import_records_mut()[manifest].as_mut_slice() {
                if !record.source_index.is_valid() {
                    continue;
                }
                let named = record.source_index.get() as usize;
                if !loaders[named].should_copy_for_bundling()
                    || flags[named].contains(InputFileFlags::IS_WEB_MANIFEST_FOLLOWED)
                {
                    record.source_index = Index::INVALID;
                }
            }
        }
    }
}

/// A followed manifest among the files that `process_files_to_copy` names.
pub(crate) struct Copied<'a> {
    /// Index into the templates.
    pub(crate) template: usize,
    /// The hash of the manifest's own bytes.
    pub(crate) content_hash: u64,
    pub(crate) public_path: &'a [u8],
}

/// A copy holds the paths of the files it names, so its name follows them: its hash
/// becomes that of its own bytes, those paths and the public path. `template_of` maps
/// a source index to its index in `templates`. Returns whether a hash changed; the
/// caller then widens the names again, which can change a path, and calls this again.
pub(crate) fn rename(
    manifests: &[Copied<'_>],
    templates: &mut [(usize, PathTemplate)],
    template_of: &[u32],
    content_hashes: &mut [u64],
    import_records: &[import_record::List<'_>],
    sanitize_parent_dirs: bool,
) -> bool {
    let mut renamed = false;
    let mut path: Vec<u8> = Vec::new();
    for manifest in manifests {
        let index = templates[manifest.template].0;
        let mut hasher = ContentHasher::default();
        hasher.write(&manifest.content_hash.to_ne_bytes());
        hasher.write(manifest.public_path);
        for record in import_records[index].iter() {
            if !record.source_index.is_valid() {
                continue;
            }
            let named = template_of[record.source_index.get() as usize];
            let Some((_, template)) = templates.get(named as usize) else {
                continue;
            };
            path.clear();
            template
                .print(&mut path, sanitize_parent_dirs)
                .expect("oom");
            resolve_path::platform_to_posix_in_place::<u8>(&mut path);
            hasher.write(&path);
        }
        let hash = hasher.digest();
        if content_hashes[index] != hash {
            content_hashes[index] = hash;
            let template = &mut templates[manifest.template].1;
            if template.placeholder.hash.is_some() {
                template.placeholder.hash = Some(template.content_hash(hash));
            }
            renamed = true;
        }
    }
    renamed
}

/// The manifest's bytes with each `src` that names an emitted file replaced by that
/// file's path, in the form a chunk uses for an asset (`IntermediateOutput::code`).
pub(crate) fn with_paths<'a>(
    contents: &[u8],
    records: &[ImportRecord],
    dest_path: &[u8],
    public_path: &[u8],
    dest_path_of: impl Fn(IndexInt) -> Option<&'a [u8]>,
) -> Box<[u8]> {
    let mut from_dir = resolve_path::dirname::<Posix>(dest_path);
    if from_dir == b"." {
        from_dir = b"";
    }
    let outdir_relative = from_dir.is_empty() || !public_path.is_empty();
    let mut relative_buf = bun_paths::path_buffer_pool::get();
    let unquoted = bun_core::fmt::JSONFormatterUTF8Options { quote: false };

    let mut out: Vec<u8> = Vec::with_capacity(contents.len());
    let mut written: usize = 0;
    for record in records {
        if !record.source_index.is_valid() {
            continue;
        }
        let Some(named) = dest_path_of(record.source_index.get()) else {
            continue;
        };
        let start = record.range.loc.start as usize;
        out.extend_from_slice(&contents[written..start]);
        written = start + record.range.len as usize;

        let path = bun_core::cheap_prefix_normalizer(
            public_path,
            if outdir_relative {
                named
            } else {
                resolve_path::relative_platform_buf::<Posix, false>(
                    &mut relative_buf[..],
                    from_dir,
                    named,
                )
            },
        );
        out.push(b'"');
        for part in path {
            write!(
                out,
                "{}",
                bun_core::fmt::format_json_string_utf8(part, unquoted)
            )
            .expect("oom");
        }
        out.push(b'"');
    }
    out.extend_from_slice(&contents[written..]);
    out.into_boxed_slice()
}
