//! JSC bridges for `bun_install::Dependency`. The `to_js`/`from_js` surface
//! lives here as extension-trait methods on the base type.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};
use bun_semver_jsc::SemverStringJsc as _;

pub(crate) fn version_to_js(
    dep: &bun_install_types::dependency::Version,
    buf: &[u8],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    use bun_core::String as BunString;
    use bun_install_types::dependency::{self, Tag};

    let object = JSValue::create_empty_object(global, 0);
    object.put(
        global,
        b"type",
        BunString::static_(<&'static str>::from(dep.tag).as_bytes()).to_js(global)?,
    );

    // `dependency::Version` keeps `Value` as a `#[repr(C)] union`
    // (discriminant in `Version.tag`); the tag-checked accessors on
    // `DependencyVersion` (`npm()`, `git()`, …) wrap the union read.
    match dep.tag {
        Tag::DistTag => {
            let v = dep.dist_tag();
            object.put(global, b"name", v.name.to_js(buf, global)?);
            object.put(global, b"tag", v.tag.to_js(buf, global)?);
        }
        Tag::Folder => {
            let v = dep.folder();
            object.put(global, b"folder", v.to_js(buf, global)?);
        }
        Tag::Git => {
            let v = dep.git();
            object.put(global, b"owner", v.owner.to_js(buf, global)?);
            object.put(global, b"repo", v.repo.to_js(buf, global)?);
            object.put(global, b"ref", v.committish.to_js(buf, global)?);
        }
        Tag::Github => {
            let v = dep.github();
            object.put(global, b"owner", v.owner.to_js(buf, global)?);
            object.put(global, b"repo", v.repo.to_js(buf, global)?);
            object.put(global, b"ref", v.committish.to_js(buf, global)?);
        }
        Tag::Npm => {
            let v = dep.npm();
            object.put(global, b"name", v.name.to_js(buf, global)?);
            let mut version_str = BunString::create_format(format_args!("{}", v.version.fmt(buf)));
            object.put(global, b"version", version_str.transfer_to_js(global)?);
            object.put(global, b"alias", JSValue::js_boolean(v.is_alias));
        }
        Tag::Symlink => {
            let v = dep.symlink();
            object.put(global, b"path", v.to_js(buf, global)?);
        }
        Tag::Workspace => {
            let v = dep.workspace();
            object.put(global, b"name", v.to_js(buf, global)?);
        }
        Tag::Tarball => {
            let v = dep.tarball();
            object.put(global, b"name", v.package_name.to_js(buf, global)?);
            match &v.uri {
                dependency::URI::Local(local) => {
                    object.put(global, b"path", local.to_js(buf, global)?);
                }
                dependency::URI::Remote(remote) => {
                    object.put(global, b"url", remote.to_js(buf, global)?);
                }
            }
        }
        _ => {
            return Err(global.throw_todo(b"Unsupported dependency type"));
        }
    }

    Ok(object)
}

pub fn tag_infer_from_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_core::String as BunString;
    use bun_install_types::dependency::Tag;

    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
    if arguments.is_empty() || !arguments[0].is_string() {
        return Ok(JSValue::UNDEFINED);
    }

    let dependency_str = bun_core::OwnedString::new(arguments[0].to_bun_string(global)?);
    let as_utf8 = dependency_str.to_utf8();

    let tag = Tag::infer(as_utf8.slice());
    BunString::static_(<&'static str>::from(tag)).to_js(global)
}

pub fn dependency_from_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_ast::Log;
    use bun_install_types::dependency;
    use bun_semver::SlicedString;

    let arguments = frame.arguments_old::<2>();
    let arguments = arguments.slice();
    if arguments.len() == 1 {
        return crate::update_request_jsc::from_js(global, arguments[0]);
    }

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
                return Err(global.throw_value(bun_ast_jsc::log_to_js(
                    &log,
                    global,
                    b"Failed to parse dependency",
                )?));
            }

            return Ok(JSValue::UNDEFINED);
        }
    };

    if !log.msgs.is_empty() {
        return Err(global.throw_value(bun_ast_jsc::log_to_js(
            &log,
            global,
            b"Failed to parse dependency",
        )?));
    }
    drop(log);

    version_to_js(&dep, buf, global)
}
