//! JSC bridges for `bun_install::Dependency`. In Zig this was aliased back into
//! `src/install/dependency.zig` so call sites were unchanged; in Rust the
//! `to_js`/`from_js` surface lives here as extension-trait methods on the base
//! type (see PORTING.md "Idiom map" — `*_jsc` alias lines are deleted).

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

/// Local helper: `bun_semver::String` → JS string. Mirrors
/// `bun_semver_jsc::SemverStringJsc::to_js`, but that crate stubs its own JSC
/// types (concurrent B-2), so its `JSGlobalObject`/`JSValue` are not the
/// `bun_jsc` ones. Inline the body here against the real `bun_jsc` types.
#[inline]
fn semver_string_to_js(
    s: &bun_semver::String,
    buf: &[u8],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    bun_jsc::bun_string_jsc::create_utf8_for_js(global, s.slice(buf))
}

pub fn version_to_js(
    dep: &bun_install::dependency::Version,
    buf: &[u8],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    use bun_core::String as BunString;
    use bun_install::dependency::{self, version::Tag};

    let object = JSValue::create_empty_object(global, 0);
    object.put(
        global,
        b"type",
        BunString::static_(<&'static str>::from(dep.tag).as_bytes()).to_js(global)?,
    );

    // PORT NOTE: `dependency::Version` keeps `Value` as a `#[repr(C)] union`
    // (discriminant in `Version.tag`); the tag-checked accessors on
    // `DependencyVersion` (`npm()`, `git()`, …) wrap the union read.
    match dep.tag {
        Tag::DistTag => {
            let v = dep.dist_tag();
            object.put(global, b"name", semver_string_to_js(&v.name, buf, global)?);
            object.put(global, b"tag", semver_string_to_js(&v.tag, buf, global)?);
        }
        Tag::Folder => {
            let v = dep.folder();
            object.put(global, b"folder", semver_string_to_js(v, buf, global)?);
        }
        Tag::Git => {
            let v = dep.git();
            object.put(
                global,
                b"owner",
                semver_string_to_js(&v.owner, buf, global)?,
            );
            object.put(global, b"repo", semver_string_to_js(&v.repo, buf, global)?);
            object.put(
                global,
                b"ref",
                semver_string_to_js(&v.committish, buf, global)?,
            );
        }
        Tag::Github => {
            let v = dep.github();
            object.put(
                global,
                b"owner",
                semver_string_to_js(&v.owner, buf, global)?,
            );
            object.put(global, b"repo", semver_string_to_js(&v.repo, buf, global)?);
            object.put(
                global,
                b"ref",
                semver_string_to_js(&v.committish, buf, global)?,
            );
        }
        Tag::Npm => {
            let v = dep.npm();
            object.put(global, b"name", semver_string_to_js(&v.name, buf, global)?);
            let mut version_str = BunString::create_format(format_args!("{}", v.version.fmt(buf)));
            object.put(global, b"version", version_str.transfer_to_js(global)?);
            object.put(global, b"alias", JSValue::js_boolean(v.is_alias));
        }
        Tag::Symlink => {
            let v = dep.symlink();
            object.put(global, b"path", semver_string_to_js(v, buf, global)?);
        }
        Tag::Workspace => {
            let v = dep.workspace();
            object.put(global, b"name", semver_string_to_js(v, buf, global)?);
        }
        Tag::Tarball => {
            let v = dep.tarball();
            object.put(
                global,
                b"name",
                semver_string_to_js(&v.package_name, buf, global)?,
            );
            match &v.uri {
                dependency::tarball::Uri::Local(local) => {
                    object.put(global, b"path", semver_string_to_js(local, buf, global)?);
                }
                dependency::tarball::Uri::Remote(remote) => {
                    object.put(global, b"url", semver_string_to_js(remote, buf, global)?);
                }
            }
        }
        _ => {
            return Err(global.throw_todo(b"Unsupported dependency type"));
        }
    }

    Ok(object)
}

// TODO(port): proc-macro — `#[bun_jsc::host_fn]` ABI wrapper.
pub fn tag_infer_from_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_core::String as BunString;
    use bun_install::dependency::{TagExt, version::Tag};

    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
    if arguments.is_empty() || !arguments[0].is_string() {
        return Ok(JSValue::UNDEFINED);
    }

    let dependency_str = arguments[0].to_bun_string(global)?;
    let as_utf8 = dependency_str.to_utf8();

    let tag = Tag::infer(as_utf8.slice());
    BunString::static_(<&'static str>::from(tag)).to_js(global)
}

/// Local helper for `log.toJS(global, msg)` — thin re-export now that
/// `bun_logger_jsc` is typed against the real `bun_jsc` surface.
#[inline]
pub(crate) fn log_to_js(
    log: &bun_ast::Log,
    global: &JSGlobalObject,
    msg: &[u8],
) -> JsResult<JSValue> {
    bun_ast_jsc::log_to_js(log, global, msg)
}

// TODO(port): proc-macro — `#[bun_jsc::host_fn]` ABI wrapper.
pub fn dependency_from_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_ast::Log;
    use bun_install::dependency;
    use bun_semver::SlicedString;

    let arguments = frame.arguments_old::<2>();
    let arguments = arguments.slice();
    if arguments.len() == 1 {
        return crate::update_request_jsc::from_js(global, arguments[0]);
    }
    // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B
    // PERF(port): was stack-fallback (std.heap.stackFallback(1024, ...)) — profile in Phase B

    let alias_value: JSValue = if !arguments.is_empty() {
        arguments[0]
    } else {
        JSValue::UNDEFINED
    };

    if !alias_value.is_string() {
        return Ok(JSValue::UNDEFINED);
    }
    let alias_slice = alias_value.to_slice(global)?;

    if alias_slice.slice().is_empty() {
        return Ok(JSValue::UNDEFINED);
    }

    let name_value: JSValue = if arguments.len() > 1 {
        arguments[1]
    } else {
        JSValue::UNDEFINED
    };
    let name_slice = name_value.to_slice(global)?;

    // PORT NOTE: reshaped for borrowck — Zig built `name`/`alias`/`buf` as
    // overlapping slices into a StringBuilder's single allocation. Rust's
    // `StringBuilder::append` returns `&[u8]` borrowing `&mut self`, so we
    // can't hold two appended slices at once. Instead, build into an owned
    // `Vec<u8>` and reslice by offset (same memory layout, no aliasing fight).
    let owned_buf: Vec<u8>;
    let (buf, name, alias): (&[u8], &[u8], &[u8]) = if name_value.is_string() {
        let nlen = name_slice.slice().len();
        let alen = alias_slice.slice().len();
        let mut v = Vec::with_capacity(nlen + alen);
        v.extend_from_slice(name_slice.slice());
        v.extend_from_slice(alias_slice.slice());
        owned_buf = v;
        let b: &[u8] = owned_buf.as_slice();
        (b, &b[..nlen], &b[nlen..nlen + alen])
    } else {
        let a = alias_slice.slice();
        (a, a, a)
    };

    let mut log = Log::init();
    let sliced = SlicedString::init(buf, name);

    let dep: dependency::Version = match dependency::parse(
        SlicedString::init(buf, alias).value(),
        None,
        buf,
        &sliced,
        Some(&mut log),
        None,
    ) {
        Some(d) => d,
        None => {
            if !log.msgs.is_empty() {
                return Err(global.throw_value(log_to_js(
                    &log,
                    global,
                    b"Failed to parse dependency",
                )?));
            }

            return Ok(JSValue::UNDEFINED);
        }
    };

    if !log.msgs.is_empty() {
        return Err(global.throw_value(log_to_js(&log, global, b"Failed to parse dependency")?));
    }
    drop(log);

    version_to_js(&dep, buf, global)
}

// ported from: src/install_jsc/dependency_jsc.zig
