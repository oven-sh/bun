use crate::jsc::rare_data::PathBuf as RarePathBuf;
use crate::jsc::{
    JSGlobalObject, JSStringView, JSValue, JsResult, StringJsc as _, SysErrorJsc as _,
    bun_string_jsc,
};
use crate::node::validators::{validate_object, validate_string};
use bun_collections::smallvec::SmallVec;
use bun_core::Utf8Bytes;
use bun_node_path::{
    CHAR_BACKWARD_SLASH, CHAR_FORWARD_SLASH, CHAR_STR_DOT, PathCharCwd, PathParsed,
    basename_posix_t, basename_windows_t, dirname_posix_t, dirname_windows_t, extname_posix_t,
    extname_windows_t, format_t, is_absolute_posix_t, is_absolute_windows_t, join_posix_t,
    join_windows_t, normalize_posix_t, normalize_windows_t, parse_posix_t, parse_windows_t,
    path_size, relative_buf_len, relative_posix_t, relative_windows_t, resolve_buf_len,
    resolve_posix_t, resolve_windows_t, to_namespaced_path_buf_len, to_namespaced_path_windows_t,
};
use bun_paths::MAX_PATH_BYTES;

/// Create a JS string from a `[T]` slice (T = u8 | u16).
///
/// In practice every JS entry point converts to a UTF-8 slice first and
/// instantiates with `T = u8`, so the `u16` arm is never reached at runtime — but it must still
/// type-check. Dispatch on `T::IS_U16` and route the cold u16 arm through
/// a UTF-16 `BunString` clone + `to_js` so the generic body unifies.
#[inline]
fn create_js_string_t<T: PathCharCwd>(global: &JSGlobalObject, s: &[T]) -> JsResult<JSValue> {
    if T::IS_U16 {
        // T == u16 when IS_U16; bytemuck statically checks the layout.
        let s16: &[u16] = bytemuck::cast_slice::<T, u16>(s);
        bun_core::String::clone_utf16(s16).into_js(global)
    } else {
        // T == u8 when !IS_U16; bytemuck statically checks the layout.
        let s8: &[u8] = bytemuck::cast_slice::<T, u8>(s);
        bun_string_jsc::create_utf8_for_js(global, s8)
    }
}

/// Pooled path scratch carved from the per-VM [`RarePathBuf`].
///
/// JS is single-threaded, so re-using the lazily-allocated tier across calls is
/// sound. When the request exceeds the largest tier (32 × `MAX_PATH_BYTES`) —
/// or when `T = u16`, since the pool is byte-typed — we spill to a one-shot
/// zeroed heap slab instead (`T: Pod`, so the zero-fill is the cost of handing
/// out a safe `&mut [T]`; consumers are write-before-read so the zeros are
/// never observed).
enum PathScratch<'a, T: PathCharCwd> {
    Pooled(&'a mut [T]),
    Spill(Box<[T]>),
}

impl<'a, T: PathCharCwd> PathScratch<'a, T> {
    /// Largest pool tier in `RarePathBuf` (`32 * MAX_PATH_BYTES`).
    const POOL_MAX: usize = 32 * MAX_PATH_BYTES;

    #[inline]
    fn new(pool: &'a mut RarePathBuf, len: usize) -> Self {
        if !T::IS_U16 && len <= Self::POOL_MAX {
            // SAFETY-adjacent: `!IS_U16` ⇒ `T == u8`; `cast_slice_mut::<u8, u8>`
            // is the bytemuck identity cast — never panics, no alignment hazard.
            let bytes = &mut pool.get(len)[..len];
            Self::Pooled(bytemuck::cast_slice_mut::<u8, T>(bytes))
        } else {
            // `T: Pod` ⇒ `T: Zeroable + Copy`. Spill is rare (u8 only when
            // >128 KB) or path-sized (u16), so the zero-fill is negligible and
            // buys a safe `&mut [T]` in `slice()`.
            Self::Spill(vec![<T as bytemuck::Zeroable>::zeroed(); len].into_boxed_slice())
        }
    }

    #[inline]
    fn slice(&mut self) -> &mut [T] {
        match self {
            Self::Pooled(s) => s,
            Self::Spill(b) => &mut b[..],
        }
    }
}

// `&JSGlobalObject` is ABI-identical to a non-null pointer; remaining params are
// by-value `JSValue`, so no caller-side preconditions remain.
unsafe extern "C" {
    safe fn PathParsedObject__create(
        global: &JSGlobalObject,
        root: JSValue,
        dir: JSValue,
        base: JSValue,
        ext: JSValue,
        name: JSValue,
    ) -> JSValue;
}

trait PathParsedJs {
    fn to_js_object(&self, global_object: &JSGlobalObject) -> JsResult<JSValue>;
}

impl<'a, T: PathCharCwd> PathParsedJs for PathParsed<'a, T> {
    fn to_js_object(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let root = create_js_string_t::<T>(global_object, self.root)?;
        let dir = create_js_string_t::<T>(global_object, self.dir)?;
        let base = create_js_string_t::<T>(global_object, self.base)?;
        let ext = create_js_string_t::<T>(global_object, self.ext)?;
        let name_val = create_js_string_t::<T>(global_object, self.name)?;
        Ok(PathParsedObject__create(
            global_object,
            root,
            dir,
            base,
            ext,
            name_val,
        ))
    }
}

pub(crate) fn basename_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    suffix: Option<&[T]>,
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, basename_posix_t(path, suffix))
}

pub(crate) fn basename_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    suffix: Option<&[T]>,
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, basename_windows_t(path, suffix))
}

pub(crate) fn basename_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
    suffix: Option<&[T]>,
) -> JsResult<JSValue> {
    if is_windows {
        basename_windows_js_t(global_object, path, suffix)
    } else {
        basename_posix_js_t(global_object, path, suffix)
    }
}

pub(crate) fn basename(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let suffix_ptr: Option<JSValue> = if args_len > 1 && !args[1].is_undefined() {
        Some(args[1])
    } else {
        None
    };

    if let Some(_suffix_ptr) = suffix_ptr {
        validate_string(global_object, _suffix_ptr, format_args!("ext"))?;
    }

    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_str = path_ptr.to_js_string_view(global_object)?;
    if path_str.is_empty() {
        return Ok(path_ptr);
    }

    let path_slice = path_str.to_utf8();

    let suffix_str = match suffix_ptr {
        Some(suffix_ptr) => Some(suffix_ptr.to_js_string_view(global_object)?),
        None => None,
    };
    let suffix_slice = suffix_str
        .as_ref()
        .filter(|s| !s.is_empty() && s.length() <= path_str.length())
        .map(|s| s.to_utf8());
    basename_js_t::<u8>(
        global_object,
        is_windows,
        path_slice.slice(),
        suffix_slice.as_ref().map(|s| s.slice()),
    )
}

fn dirname_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, dirname_posix_t(path))
}

fn dirname_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, dirname_windows_t(path))
}

fn dirname_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if is_windows {
        dirname_windows_js_t(global_object, path)
    } else {
        dirname_posix_js_t(global_object, path)
    }
}

fn dirname(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_str = path_ptr.to_js_string_view(global_object)?;
    if path_str.is_empty() {
        return bun_core::String::static_(CHAR_STR_DOT).to_js(global_object);
    }

    let path_slice = path_str.to_utf8();
    dirname_js_t::<u8>(global_object, is_windows, path_slice.slice())
}

fn extname_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, extname_posix_t(path))
}

fn extname_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, extname_windows_t(path))
}

fn extname_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if is_windows {
        extname_windows_js_t(global_object, path)
    } else {
        extname_posix_js_t(global_object, path)
    }
}

fn extname(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_str = path_ptr.to_js_string_view(global_object)?;
    if path_str.is_empty() {
        return Ok(path_ptr);
    }

    let path_slice = path_str.to_utf8();
    extname_js_t::<u8>(global_object, is_windows, path_slice.slice())
}

fn format_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path_object: &PathParsed<'_, T>,
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(
        global_object,
        format_t(path_object, T::from_u8(CHAR_FORWARD_SLASH), buf),
    )
}

fn format_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path_object: &PathParsed<'_, T>,
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(
        global_object,
        format_t(path_object, T::from_u8(CHAR_BACKWARD_SLASH), buf),
    )
}

fn format_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    path_object: &PathParsed<'_, T>,
) -> JsResult<JSValue> {
    let base_len = path_object.base.len();
    let dir_len = path_object.dir.len();
    // Add one for the possible separator.
    let buf_len: usize =
        (1 + (if dir_len > 0 {
            dir_len
        } else {
            path_object.root.len()
        }) + (if base_len > 0 {
            base_len
        } else {
            path_object.name.len() + path_object.ext.len() + 1
        }))
        .max(path_size::<T>());
    let mut scratch = PathScratch::<T>::new(pool, buf_len);
    let buf = scratch.slice();
    if is_windows {
        format_windows_js_t(global_object, path_object, buf)
    } else {
        format_posix_js_t(global_object, path_object, buf)
    }
}

fn format(global_object: &JSGlobalObject, is_windows: bool, args: &[JSValue]) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_object_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    validate_object(
        global_object,
        path_object_ptr,
        format_args!("pathObject"),
        Default::default(),
    )?;

    let mut root: &[u8] = b"";
    let root_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "root")? {
        Some(js_value.to_utf8(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = root_slice {
        root = slice.slice();
    }

    let mut dir: &[u8] = b"";
    let dir_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "dir")? {
        Some(js_value.to_utf8(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = dir_slice {
        dir = slice.slice();
    }

    let mut base: &[u8] = b"";
    let base_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "base")? {
        Some(js_value.to_utf8(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = base_slice {
        base = slice.slice();
    }

    let mut _name: &[u8] = b"";
    let _name_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "name")? {
        Some(js_value.to_utf8(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = _name_slice {
        _name = slice.slice();
    }

    let mut ext: &[u8] = b"";
    let ext_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "ext")? {
        Some(js_value.to_utf8(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = ext_slice {
        ext = slice.slice();
    }

    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    format_js_t::<u8>(
        global_object,
        pool,
        is_windows,
        &PathParsed {
            root,
            dir,
            base,
            ext,
            name: _name,
        },
    )
}

fn is_absolute_posix_string(path: &bun_core::String) -> bool {
    let path_trunc = path.trunc(1);
    if path_trunc.is_utf16() {
        is_absolute_posix_t::<u16>(path_trunc.utf16())
    } else {
        is_absolute_posix_t::<u8>(path_trunc.latin1())
    }
}

fn is_absolute_windows_string(path: &bun_core::String) -> bool {
    if path.is_utf16() {
        is_absolute_windows_t::<u16>(path.utf16())
    } else {
        is_absolute_windows_t::<u8>(path.latin1())
    }
}

fn is_absolute(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_str = path_ptr.to_js_string_view(global_object)?;
    if path_str.is_empty() {
        return Ok(JSValue::FALSE);
    }
    if is_windows {
        return Ok(JSValue::from(is_absolute_windows_string(&path_str)));
    }
    Ok(JSValue::from(is_absolute_posix_string(&path_str)))
}

/// # Safety
/// `rhs_ptr[..rhs_len]` must be a valid readable slice. Called only from C++.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Node__Path_joinWTF(
    lhs: &bun_core::String,
    rhs_ptr: *const u8,
    rhs_len: usize,
) -> bun_core::String {
    // SAFETY: caller passes a valid slice from C++.
    let rhs = unsafe { bun_core::ffi::slice(rhs_ptr, rhs_len) };
    let mut buf = [0u8; path_size::<u8>()];
    let mut buf2 = [0u8; path_size::<u8>()];
    let lhs = lhs.to_utf8();
    #[cfg(windows)]
    let joined = join_windows_t::<u8>(&[lhs.slice(), rhs], &mut buf, &mut buf2);
    #[cfg(not(windows))]
    let joined = join_posix_t::<u8>(&[lhs.slice(), rhs], &mut buf, &mut buf2);
    bun_core::String::clone_utf8(joined)
}

fn join_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, join_posix_t(paths, buf, buf2))
}

fn join_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, join_windows_t(paths, buf, buf2))
}

fn join_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    paths: &[&[T]],
) -> JsResult<JSValue> {
    // Adding 8 bytes when Windows for the possible UNC root.
    let mut buf_len: usize = if is_windows { 8 } else { 0 };
    for path in paths {
        buf_len += if !path.is_empty() {
            path.len() + 1
        } else {
            path.len()
        };
    }
    buf_len = buf_len.max(path_size::<T>());
    let mut scratch = PathScratch::<T>::new(pool, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    if is_windows {
        join_windows_js_t(global_object, paths, buf, buf2)
    } else {
        join_posix_js_t(global_object, paths, buf, buf2)
    }
}

pub(crate) fn join(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    if args_len == 0 {
        return bun_core::String::static_(CHAR_STR_DOT).to_js(global_object);
    }

    // ASCII-only inputs (the common case) borrow the JSString backing without
    // allocating; only non-ASCII triggers a transcode allocation.
    let mut views: SmallVec<[JSStringView<'_>; 8]> = SmallVec::with_capacity(args_len);

    for (i, &path_ptr) in args.iter().enumerate() {
        // Inline the `is_string` fast path; only build `format_args!("paths[{i}]")`
        // on the cold error branch (it materialises a 48-byte `fmt::Arguments`
        // every iteration otherwise).
        if !path_ptr.is_string() {
            #[cold]
            #[inline(never)]
            fn not_a_string(g: &JSGlobalObject, v: JSValue, i: usize) -> crate::jsc::JsError {
                validate_string(g, v, format_args!("paths[{}]", i)).unwrap_err()
            }
            return Err(not_a_string(global_object, path_ptr, i));
        }
        let path_str = path_ptr.to_js_string_view(global_object)?;
        if path_str.is_empty() {
            continue;
        }
        views.push(path_str);
    }
    let owned: SmallVec<[Utf8Bytes<'_>; 8]> = views.iter().map(JSStringView::to_utf8).collect();
    let paths: SmallVec<[&[u8]; 8]> = owned.iter().map(Utf8Bytes::slice).collect();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    join_js_t::<u8>(global_object, pool, is_windows, &paths)
}

fn normalize_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, normalize_posix_t(path, buf))
}

fn normalize_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, normalize_windows_t(path, buf))
}

fn normalize_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    let buf_len = path.len().max(path_size::<T>());
    // +1 for null terminator
    let mut scratch = PathScratch::<T>::new(pool, buf_len + 1);
    let buf = scratch.slice();
    if is_windows {
        normalize_windows_js_t(global_object, path, buf)
    } else {
        normalize_posix_js_t(global_object, path, buf)
    }
}

fn normalize(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    validate_string(global_object, path_ptr, format_args!("path"))?;
    let path_str = path_ptr.to_js_string_view(global_object)?;
    if path_str.is_empty() {
        return bun_core::String::static_(CHAR_STR_DOT).to_js(global_object);
    }

    let path_slice = path_str.to_utf8();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    normalize_js_t::<u8>(global_object, pool, is_windows, path_slice.slice())
}

pub(crate) fn parse_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    parse_posix_t(path).to_js_object(global_object)
}

pub(crate) fn parse_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    parse_windows_t(path).to_js_object(global_object)
}

pub(crate) fn parse_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if is_windows {
        parse_windows_js_t(global_object, path)
    } else {
        parse_posix_js_t(global_object, path)
    }
}

pub(crate) fn parse(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    crate::node::validators_impl::validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_str = path_ptr.to_js_string_view(global_object)?;
    if path_str.is_empty() {
        return PathParsed::<u8>::default().to_js_object(global_object);
    }

    let path_slice = path_str.to_utf8();
    parse_js_t::<u8>(global_object, is_windows, path_slice.slice())
}

fn relative_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    from: &[T],
    to: &[T],
    buf: &mut [T],
    from_buf: &mut [T],
    tmp_buf: &mut [T],
) -> JsResult<JSValue> {
    match relative_posix_t(from, to, buf, from_buf, tmp_buf) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

fn relative_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    from: &[T],
    to: &[T],
    buf: &mut [T],
    from_buf: &mut [T],
    tmp_buf: &mut [T],
) -> JsResult<JSValue> {
    match relative_windows_t(from, to, buf, from_buf, tmp_buf) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

fn relative_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    from: &[T],
    to: &[T],
) -> JsResult<JSValue> {
    // ×3 for buf/from_buf/tmp_buf carved from one slab.
    let buf_len = relative_buf_len(from, to);
    let mut scratch = PathScratch::<T>::new(pool, buf_len * 3);
    let (buf, rest) = scratch.slice().split_at_mut(buf_len);
    let (from_buf, tmp_buf) = rest.split_at_mut(buf_len);
    if is_windows {
        relative_windows_js_t(global_object, from, to, buf, from_buf, tmp_buf)
    } else {
        relative_posix_js_t(global_object, from, to, buf, from_buf, tmp_buf)
    }
}

fn relative(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let from_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    crate::node::validators_impl::validate_string(global_object, from_ptr, format_args!("from"))?;
    let to_ptr: JSValue = if args_len > 1 {
        args[1]
    } else {
        JSValue::UNDEFINED
    };
    crate::node::validators_impl::validate_string(global_object, to_ptr, format_args!("to"))?;

    let from_str = from_ptr.to_js_string_view(global_object)?;
    let to_str = to_ptr.to_js_string_view(global_object)?;
    if from_str.is_empty() && to_str.is_empty() {
        return Ok(from_ptr);
    }

    let from_slice = from_str.to_utf8();
    let to_slice_ = to_str.to_utf8();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    relative_js_t::<u8>(
        global_object,
        pool,
        is_windows,
        from_slice.slice(),
        to_slice_.slice(),
    )
}

#[cfg(unix)]
unsafe extern "C" {
    safe fn Process__getCachedCwd(global: &JSGlobalObject) -> JSValue;
}

fn resolve_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    match resolve_posix_t(paths, buf, buf2) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

fn resolve_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    match resolve_windows_t(paths, buf, buf2) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

fn resolve_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    paths: &[&[T]],
) -> JsResult<JSValue> {
    // Carve buf/buf2 from one pooled slab.
    let buf_len = resolve_buf_len(is_windows, paths);
    let mut scratch = PathScratch::<T>::new(pool, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    if is_windows {
        resolve_windows_js_t(global_object, paths, buf, buf2)
    } else {
        resolve_posix_js_t(global_object, paths, buf, buf2)
    }
}

fn resolve(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    // Lazily-allocated RareData buffer replaces the old stack_fallback_size_large
    // on the stack; `PathScratch` spills to the heap for very long paths.

    // Borrow each argument's JSString backing as `Utf8Bytes` (ASCII inputs
    // borrow in place, only non-ASCII transcodes). Inline-8 keeps the typical
    // call alloc-free. Walk back-to-front to early-out on the first absolute
    // POSIX path; reverse the borrowed views before handing to `resolve_*_t`.
    let mut views: SmallVec<[JSStringView<'_>; 8]> = SmallVec::new();
    let mut resolved_root = false;

    let mut i = args_len;
    while i > 0 {
        i -= 1;

        if resolved_root {
            break;
        }

        let path = args[i as usize];
        validate_string(global_object, path, format_args!("paths[{}]", i))?;
        let path_str = path.to_js_string_view(global_object)?;
        if path_str.is_empty() {
            continue;
        }

        if !is_windows && path_str.char_at(0) == u16::from(CHAR_FORWARD_SLASH) {
            resolved_root = true;
        }
        views.push(path_str);
    }

    let owned: SmallVec<[Utf8Bytes<'_>; 8]> = views.iter().map(JSStringView::to_utf8).collect();
    let paths: SmallVec<[&[u8]; 8]> = owned.iter().rev().map(Utf8Bytes::slice).collect();

    #[cfg(unix)]
    {
        if !is_windows {
            // Micro-optimization #1: avoid creating a new string when passing no arguments or only empty strings.
            // Micro-optimization #2: path.resolve(".") and path.resolve("./") === process.cwd()
            if paths.is_empty() || (paths.len() == 1 && (paths[0] == b"." || paths[0] == b"./")) {
                // Throws when `getcwd` fails (for example, a deleted cwd).
                return crate::jsc::call_zero_is_throw(global_object, || {
                    Process__getCachedCwd(global_object)
                });
            }
        }
    }

    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    resolve_js_t::<u8>(global_object, pool, is_windows, &paths)
}

fn to_namespaced_path_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    match to_namespaced_path_windows_t(path, buf, buf2) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

fn to_namespaced_path_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if !is_windows || path.is_empty() {
        return create_js_string_t::<T>(global_object, path);
    }
    // ×2 for buf/buf2.
    let buf_len = to_namespaced_path_buf_len(path);
    let mut scratch = PathScratch::<T>::new(pool, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    to_namespaced_path_windows_js_t(global_object, path, buf, buf2)
}

fn to_namespaced_path(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    if args_len == 0 {
        return Ok(JSValue::UNDEFINED);
    }
    let path_ptr = args[0];

    // Based on Node v21.6.1 path.win32.toNamespacedPath and path.posix.toNamespacedPath:
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L624
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1269
    //
    // Act as an identity function for non-string values and non-Windows platforms.
    if !is_windows || !path_ptr.is_string() {
        return Ok(path_ptr);
    }
    let path_str = path_ptr.to_js_string_view(global_object)?;
    if path_str.is_empty() {
        return Ok(path_ptr);
    }

    let path_slice = path_str.to_utf8();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    to_namespaced_path_js_t::<u8>(global_object, pool, is_windows, path_slice.slice())
}

// Emit the SYSV-ABI thunks locally.
// Each wrapper forwards `(global, is_windows, args_ptr, args_len)` and routes the
// `JsResult<JSValue>` through `host_fn::to_js_host_call`.
//
// ABI: The C++ side (src/jsc/bindings/Path.cpp) declares these as
// `SYSV_ABI`, so on Windows-x64 the wrapper MUST be `extern "sysv64"` — using
// `extern "C"` there would be the Win64 ABI (RCX/RDX/R8/R9 + shadow space) and
// would mis-read every argument.
macro_rules! export_path_host_fn {
    ($( $export:literal => $target:path ),* $(,)?) => {$(
        const _: () = {
            #[cfg(all(windows, target_arch = "x86_64"))]
            #[unsafe(export_name = $export)]
            extern "sysv64" fn __wrapped(
                global: &JSGlobalObject,
                is_windows: bool,
                args_ptr: *const JSValue,
                args_len: u16,
            ) -> JSValue {
                // SAFETY: `args_ptr` points to `args_len` JSValues from the C++
                // CallFrame (NodePath.cpp). Borrowed for the synchronous call.
                // (Body kept in sync with the non-Windows arm below — bughunt
                // changed the target signature to take a slice but only updated
                // one cfg arm.)
                let args = unsafe { bun_core::ffi::slice(args_ptr, args_len as usize) };
                crate::jsc::host_fn::to_js_host_call(
                    global,
                    || $target(global, is_windows, args),
                )
            }
            #[cfg(not(all(windows, target_arch = "x86_64")))]
            #[unsafe(export_name = $export)]
            extern "C" fn __wrapped(
                global: &JSGlobalObject,
                is_windows: bool,
                args_ptr: *const JSValue,
                args_len: u16,
            ) -> JSValue {
                // SAFETY: `args_ptr` points to `args_len` JSValues from the C++
                // CallFrame (the caller is `Bun__Path__*` in NodePath.cpp). The
                // slice is borrowed for the synchronous host-call only.
                let args = unsafe { bun_core::ffi::slice(args_ptr, args_len as usize) };
                crate::jsc::host_fn::to_js_host_call(
                    global,
                    || $target(global, is_windows, args),
                )
            }
        };
    )*};
}
export_path_host_fn! {
    "Bun__Path__basename" => basename,
    "Bun__Path__dirname" => dirname,
    "Bun__Path__extname" => extname,
    "Bun__Path__format" => format,
    "Bun__Path__isAbsolute" => is_absolute,
    "Bun__Path__join" => join,
    "Bun__Path__normalize" => normalize,
    "Bun__Path__parse" => parse,
    "Bun__Path__relative" => relative,
    "Bun__Path__resolve" => resolve,
    "Bun__Path__toNamespacedPath" => to_namespaced_path,
}
