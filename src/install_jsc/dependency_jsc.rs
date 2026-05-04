//! JSC bridges for `bun_install::Dependency`. In Zig this was aliased back into
//! `src/install/dependency.zig` so call sites were unchanged; in Rust the
//! `to_js`/`from_js` surface lives here as extension-trait methods on the base
//! type (see PORTING.md "Idiom map" — `*_jsc` alias lines are deleted).

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::String as BunString;
// TODO(port): confirm crate for StringBuilder (bun.StringBuilder) — assuming bun_str
use bun_str::StringBuilder;
use bun_logger::Log;
use bun_semver::SlicedString;
use bun_install::Dependency;
use bun_install::dependency::{self, version::Tag};
// TODO(port): extension traits providing .to_js() on bun_str::String / install
// string types / bun_logger::Log inside *_jsc crates — exact module paths TBD
// in Phase B.
use bun_str_jsc::StringJsc as _;
use bun_logger_jsc::LogJsc as _;

pub fn version_to_js(
    dep: &dependency::Version,
    buf: &[u8],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, 0);
    object.put(
        global,
        "type",
        BunString::static_(<&'static str>::from(dep.tag)).to_js(global)?,
    );

    // TODO(port): `dependency::Version` in Zig is `struct { tag: Tag, value: Value /* bare union */ }`.
    // If the Rust port of bun_install collapses tag+value into a single Rust enum,
    // rewrite this as `match &dep.value { Value::DistTag { name, tag } => ... }`
    // and drop the unsafe union reads.
    match dep.tag {
        Tag::DistTag => {
            // SAFETY: tag == DistTag guarantees the dist_tag union arm is active.
            let v = unsafe { &dep.value.dist_tag };
            object.put(global, "name", v.name.to_js(buf, global)?);
            object.put(global, "tag", v.tag.to_js(buf, global)?);
        }
        Tag::Folder => {
            // SAFETY: tag == Folder
            let v = unsafe { &dep.value.folder };
            object.put(global, "folder", v.to_js(buf, global)?);
        }
        Tag::Git => {
            // SAFETY: tag == Git
            let v = unsafe { &dep.value.git };
            object.put(global, "owner", v.owner.to_js(buf, global)?);
            object.put(global, "repo", v.repo.to_js(buf, global)?);
            object.put(global, "ref", v.committish.to_js(buf, global)?);
        }
        Tag::Github => {
            // SAFETY: tag == Github
            let v = unsafe { &dep.value.github };
            object.put(global, "owner", v.owner.to_js(buf, global)?);
            object.put(global, "repo", v.repo.to_js(buf, global)?);
            object.put(global, "ref", v.committish.to_js(buf, global)?);
        }
        Tag::Npm => {
            // SAFETY: tag == Npm
            let v = unsafe { &dep.value.npm };
            object.put(global, "name", v.name.to_js(buf, global)?);
            let mut version_str =
                BunString::create_format(format_args!("{}", v.version.fmt(buf)))?;
            object.put(global, "version", version_str.transfer_to_js(global)?);
            object.put(global, "alias", JSValue::from(v.is_alias));
        }
        Tag::Symlink => {
            // SAFETY: tag == Symlink
            let v = unsafe { &dep.value.symlink };
            object.put(global, "path", v.to_js(buf, global)?);
        }
        Tag::Workspace => {
            // SAFETY: tag == Workspace
            let v = unsafe { &dep.value.workspace };
            object.put(global, "name", v.to_js(buf, global)?);
        }
        Tag::Tarball => {
            // SAFETY: tag == Tarball
            let v = unsafe { &dep.value.tarball };
            object.put(global, "name", v.package_name.to_js(buf, global)?);
            match &v.uri {
                dependency::tarball::Uri::Local(local) => {
                    object.put(global, "path", local.to_js(buf, global)?);
                }
                dependency::tarball::Uri::Remote(remote) => {
                    object.put(global, "url", remote.to_js(buf, global)?);
                }
            }
        }
        _ => {
            return global.throw_todo("Unsupported dependency type");
        }
    }

    Ok(object)
}

#[bun_jsc::host_fn]
pub fn tag_infer_from_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(1).slice();
    if arguments.is_empty() || !arguments[0].is_string() {
        return Ok(JSValue::UNDEFINED);
    }

    let dependency_str = arguments[0].to_bun_string(global)?;
    let as_utf8 = dependency_str.to_utf8();

    let tag = Tag::infer(as_utf8.as_bytes());
    let mut str = BunString::init(<&'static str>::from(tag));
    str.transfer_to_js(global)
}

#[bun_jsc::host_fn]
pub fn dependency_from_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(2).slice();
    if arguments.len() == 1 {
        // TODO(port): UpdateRequest::from_js lives in this crate (install_jsc) —
        // confirm exact module path in Phase B.
        return crate::package_manager::update_request_from_js(global, arguments[0]);
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

    if alias_slice.len() == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let name_value: JSValue = if arguments.len() > 1 {
        arguments[1]
    } else {
        JSValue::UNDEFINED
    };
    let name_slice = name_value.to_slice(global)?;

    let mut name = alias_slice.slice();
    let mut alias = alias_slice.slice();

    let mut buf = alias;

    // PORT NOTE: reshaped for borrowck — `builder` must outlive `name`/`alias`/`buf`
    // which borrow from its allocated slice; declared in outer scope so the
    // borrows below remain valid past the `if`.
    let mut builder;
    if name_value.is_string() {
        builder = StringBuilder::init_capacity(name_slice.len() + alias_slice.len());
        name = builder.append(name_slice.slice());
        alias = builder.append(alias_slice.slice());
        buf = builder.allocated_slice();
    }

    let mut log = Log::init();
    let sliced = SlicedString::init(buf, name);

    let dep: dependency::Version = match Dependency::parse(
        SlicedString::init(buf, alias).value(),
        None,
        buf,
        &sliced,
        &mut log,
        None,
    ) {
        Some(d) => d,
        None => {
            if !log.msgs.is_empty() {
                return global
                    .throw_value(log.to_js(global, "Failed to parse dependency")?);
            }

            return Ok(JSValue::UNDEFINED);
        }
    };

    if !log.msgs.is_empty() {
        return global.throw_value(log.to_js(global, "Failed to parse dependency")?);
    }
    drop(log);

    version_to_js(&dep, buf, global)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_jsc/dependency_jsc.zig (136 lines)
//   confidence: medium
//   todos:      3
//   notes:      Version is tag+bare-union in Zig; if Rust bun_install models it as a single enum, drop the unsafe reads. Extension-trait import paths (StringJsc/LogJsc) and UpdateRequest::from_js path are guesses.
// ──────────────────────────────────────────────────────────────────────────
