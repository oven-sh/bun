//! Moves a stale `packageManager: bun@<version>` pin in package.json to the bun that `bun upgrade` installed.

use bun_alloc::Arena;
use bun_core::{Output, ZStr, strings};
use bun_js_printer as JSPrinter;
use bun_parsers::json as JSON;
use bun_paths::{resolve_path as path, resolve_path::platform as path_platform};
use bun_semver::{PackageManagerSpec, SlicedString, Version};
use bun_sys::{Fd, File};

/// What `refresh` does with a pin that is older than the installed version.
#[derive(Clone, Copy)]
pub(crate) enum Write {
    /// Rewrite the pin in package.json.
    Save,
    /// `--no-save`: report the stale pin, leave the file alone.
    NoSave,
    /// `BUN_DRY_RUN`: report the stale pin, leave the file alone.
    DryRun,
}

/// Walks up from `start_dir` to the nearest package.json with a `packageManager` field, as Corepack does.
/// Never exits or returns an error: the caller may already have replaced the running executable.
pub(crate) fn refresh(start_dir: &[u8], installed: &[u8], write: Write) {
    let mut path_buf = bun_paths::path_buffer_pool::get();
    let mut dir = start_dir;
    loop {
        let package_json_path = path::join_abs_string_buf_z::<path_platform::Auto>(
            dir,
            &mut path_buf.0,
            &[b"package.json"],
        );
        match File::read_from(Fd::cwd(), package_json_path.as_bytes()) {
            Ok(contents) if strings::contains(&contents, b"packageManager") => {
                if let Walk::Done = refresh_file(package_json_path, &contents, installed, write) {
                    return;
                }
            }
            Ok(_) => {}
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => {}
            Err(err) => {
                bun_core::pretty_errorln!(
                    "<r><yellow>warn<r><d>:<r> failed to read {}: {}",
                    bstr::BStr::new(package_json_path.as_bytes()),
                    bstr::BStr::new(err.name())
                );
                return;
            }
        }

        let parent = path::dirname::<path_platform::Auto>(dir);
        if parent == dir {
            return;
        }
        dir = parent;
    }
}

enum Walk {
    /// This package.json has a `packageManager` field, or does not parse.
    Done,
    /// This package.json has no `packageManager` field. Look at its parent.
    Continue,
}

fn refresh_file(package_json_path: &ZStr, contents: &[u8], installed: &[u8], write: Write) -> Walk {
    bun_ast::initialize_store();
    let arena = Arena::new();
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(package_json_path.as_bytes(), contents);
    let parsed = JSON::parse_package_json_utf8_with_opts(
        JSON::JSONOptions {
            json_warn_duplicate_keys: false,
            guess_indentation: true,
            ..JSON::PACKAGE_JSON_OPTS
        },
        &source,
        &mut log,
        &arena,
    );
    let mut document = match parsed {
        Ok(document) if log.errors == 0 => document,
        _ => {
            bun_core::pretty_errorln!(
                "<r><yellow>warn<r><d>:<r> failed to parse {}, its packageManager field was not updated",
                bstr::BStr::new(package_json_path.as_bytes())
            );
            return Walk::Done;
        }
    };
    let Some(value) = document
        .root
        .get(b"packageManager")
        .and_then(|value| value.as_string(&arena))
    else {
        return Walk::Continue;
    };

    let Some(spec) = PackageManagerSpec::parse(value) else {
        return Walk::Done;
    };
    if !spec.is_bun() {
        return Walk::Done;
    }
    let Some(pinned) = spec.exact_version() else {
        return Walk::Done;
    };
    let Some(target) = Version::parse_exact(SlicedString::init(installed, installed)) else {
        return Walk::Done;
    };
    if pinned.order_without_build(target, spec.version_text, installed) != core::cmp::Ordering::Less
    {
        return Walk::Done;
    }

    let old = bstr::BStr::new(value);
    let new = bstr::BStr::new(installed);
    let skipped = match write {
        Write::Save => None,
        Write::NoSave => Some("--no-save"),
        Write::DryRun => Some("dry run"),
    };
    if let Some(reason) = skipped {
        bun_core::pretty_errorln!(
            "<r><b>packageManager<r> in package.json is <blue>{}<r>, the installed version is <cyan>bun@{}<r> <d>(not updated: {})<r>",
            old,
            new,
            reason
        );
        return Walk::Done;
    }

    let mut new_value = Vec::with_capacity(b"bun@".len() + installed.len());
    new_value.extend_from_slice(b"bun@");
    new_value.extend_from_slice(installed);
    let Some(object) = document.root.data.e_object_mut() else {
        return Walk::Done;
    };
    bun_core::handle_oom(object.put_string(&arena, b"packageManager", &new_value));

    let mut buffer_writer = JSPrinter::BufferWriter::init();
    buffer_writer.buffer.list.reserve(contents.len() + 1);
    buffer_writer.append_newline = contents.ends_with(b"\n");
    let mut writer = JSPrinter::BufferPrinter::init(buffer_writer);
    if let Err(err) = JSPrinter::print_json(
        &mut writer,
        document.root,
        &source,
        JSPrinter::PrintJsonOptions {
            indent: document.indentation,
            mangled_props: None,
            ..Default::default()
        },
    ) {
        bun_core::pretty_errorln!(
            "<r><yellow>warn<r><d>:<r> failed to save package.json: {}",
            err.name()
        );
        return Walk::Done;
    }

    if let Err(err) = File::write_file(
        Fd::cwd(),
        package_json_path,
        writer.ctx.written_without_trailing_zero(),
    ) {
        bun_core::pretty_errorln!(
            "<r><yellow>warn<r><d>:<r> failed to write package.json: {}",
            bstr::BStr::new(err.name())
        );
        return Walk::Done;
    }
    bun_core::pretty_errorln!(
        "<r>Updated <b>packageManager<r> in package.json to <cyan>bun@{}<r> <d>(was {})<r>",
        new,
        old
    );
    Output::flush();
    Walk::Done
}
