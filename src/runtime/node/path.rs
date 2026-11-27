//! The bodies of node_path.bind.ts.
#![forbid(unsafe_code)]

use bun_core::strings::{CodeUnits, PathByte};
use bun_node_path::fast_path::{self, StackBuffer};
use bun_node_path::{Output, PathArgs, Platform, ResolveStep, Scratch, glob, posix, utf8, win32};
use bun_paths::path_buffer_pool;

use super::path_ffi::{self, Method};
use crate::generated_bindgen::node_path::ParsedPath;
use crate::jsc::bindgen::{self, JsCharacters, JsHeap, JsLocal, JsScope, to_js};
use crate::jsc::{ErrorCode, JSString};

type JsStr<'a> = JsLocal<'a, JSString>;
type StrResult<'a> = bindgen::Result<'a, JsStr<'a>>;
type ValueResult<'a> = bindgen::Result<'a, JsLocal<'a>>;

const HOST_IS_WIN32: bool = cfg!(windows);

#[inline(never)]
fn out_of_line<R>(body: impl FnOnce() -> R) -> R {
    body()
}

/// Evaluates `$body` with `$units` bound to the slice in `$text`. The 16-bit copy of `$body` is not inlined.
macro_rules! match_code_units {
    ($text:expr, |$units:ident| $body:expr) => {
        match $text {
            CodeUnits::U8($units) => $body,
            CodeUnits::U16($units) => out_of_line(|| $body),
        }
    };
}

macro_rules! platform_call {
    ($win32:expr, $name:ident($($argument:expr),*)) => {
        if $win32 {
            win32::$name($($argument),*)
        } else {
            posix::$name($($argument),*)
        }
    };
}

#[cold]
fn to_js_error<'a>(heap: &JsHeap<'a>, error: bun_node_path::Error) -> bindgen::Error<'a> {
    match error {
        // As V8 throws when Node concatenates.
        bun_node_path::Error::StringTooLong => heap.range_error(format_args!("{error}")),
        bun_node_path::Error::Alloc(error) => error.into(),
    }
}

#[cold]
fn creation_error<'a>(
    heap: &JsHeap<'a>,
    len: usize,
    error: bindgen::Error<'a>,
) -> bindgen::Error<'a> {
    if len > bun_core::String::max_length() {
        to_js_error(heap, bun_node_path::Error::StringTooLong)
    } else {
        error
    }
}

#[inline(always)]
fn create_string<'a>(heap: &JsHeap<'a>, text: CodeUnits<'_>) -> StrResult<'a> {
    heap.try_create_string_from_units(text)
        .map_err(|error| creation_error(heap, text.len(), error))
}

enum ArgError<'a> {
    Path(bun_node_path::Error),
    Js(bindgen::Error<'a>),
    NotAString { index: usize },
}

impl From<bun_node_path::Error> for ArgError<'_> {
    fn from(error: bun_node_path::Error) -> Self {
        ArgError::Path(error)
    }
}

impl<'a> From<bindgen::Error<'a>> for ArgError<'a> {
    #[inline(always)]
    fn from(error: bindgen::Error<'a>) -> Self {
        ArgError::Js(error)
    }
}

impl<'a> ArgError<'a> {
    #[cold]
    fn into_js_error(self, heap: &JsHeap<'a>) -> bindgen::Error<'a> {
        match self {
            ArgError::Path(error) => to_js_error(heap, error),
            ArgError::Js(error) => error,
            ArgError::NotAString { index } => heap.error_with_code(
                ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"paths[{index}]\" argument must be of type string"),
            ),
        }
    }
}

trait Arg<'a>: Copy {
    fn as_str(self) -> Option<JsStr<'a>>;
}

impl<'a> Arg<'a> for JsStr<'a> {
    #[inline(always)]
    fn as_str(self) -> Option<JsStr<'a>> {
        Some(self)
    }
}

impl<'a> Arg<'a> for JsLocal<'a> {
    #[inline(always)]
    fn as_str(self) -> Option<JsStr<'a>> {
        self.as_string()
    }
}

#[derive(Clone, Copy)]
struct Args<'h, 'a, T> {
    heap: &'h JsHeap<'a>,
    paths: &'h [T],
}

impl<'h, 'a, T: Arg<'a>> PathArgs for Args<'h, 'a, T> {
    type Error = ArgError<'a>;
    type Guard = JsCharacters<'h, 'a>;

    #[inline(always)]
    fn len(self) -> usize {
        self.paths.len()
    }

    #[inline(always)]
    fn load(self, index: usize) -> Result<Self::Guard, ArgError<'a>> {
        let Some(path) = self.paths[index].as_str() else {
            core::hint::cold_path();
            return Err(ArgError::NotAString { index });
        };
        Ok(path.characters(self.heap)?)
    }

    #[inline(always)]
    fn units(guard: &Self::Guard) -> CodeUnits<'_> {
        guard.units()
    }
}

#[inline(always)]
fn to_js_string<'a>(heap: &JsHeap<'a>, args: &[impl Arg<'a>], output: Output<'_>) -> StrResult<'a> {
    let arg = |index: usize| args[index].as_str().expect("it has been loaded");
    match output {
        Output::Arg(index) => Ok(arg(index)),
        Output::ArgSlice(index, range) => Ok(arg(index).characters(heap)?.substring(heap, range)),
        Output::Built(text) => create_string(heap, text),
        Output::DotDots(dotdots) if dotdots.is_16bit() => out_of_line(|| {
            let mut scratch = Scratch::new();
            let text = dotdots.to_utf16_in(&mut scratch);
            create_string(
                heap,
                CodeUnits::U16(text.map_err(|it| to_js_error(heap, it))?),
            )
        }),
        Output::DotDots(dotdots) => heap
            .try_create_latin1_string_with(dotdots.len(), |to| dotdots.write(to))
            .map_err(|error| creation_error(heap, dotdots.len(), error)),
    }
}

/// The receiver conversion of `String.prototype` methods, for what a replaced function returned.
#[inline(always)]
fn coerce_to_string<'a>(cx: &mut JsScope<'a>, value: JsLocal<'a>) -> StrResult<'a> {
    if let Some(string) = value.as_string() {
        return Ok(string);
    }
    out_of_line(|| {
        if value.to_js().is_undefined_or_null() {
            return Err(cx.heap.type_error(format_args!(
                "String.prototype.charCodeAt called on null or undefined"
            )));
        }
        let string = value.to_js().to_js_string(cx.global())?.to_js();
        Ok(JsLocal::new(&cx.heap, string)
            .as_string()
            .expect("ToString"))
    })
}

fn is_strict_equal<'a>(
    cx: &mut JsScope<'a>,
    a: JsLocal<'a>,
    b: JsLocal<'a>,
) -> bindgen::Result<'a, bool> {
    Ok(a.to_js().is_strict_equal(b.to_js(), cx.global())?)
}

#[inline(always)]
fn basename<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    path: JsStr<'a>,
    suffix: Option<JsStr<'a>>,
) -> StrResult<'a> {
    let text = path.characters(heap)?;
    let range = match suffix {
        None => match_code_units!(text.units(), |path| platform_call!(WIN32, basename(path))),
        Some(suffix) => {
            let suffix = suffix.characters(heap)?;
            let suffix = suffix.units();
            match_code_units!(text.units(), |path| match_code_units!(suffix, |suffix| {
                platform_call!(WIN32, basename_without_suffix(path, suffix))
            }))
        }
    };
    Ok(text.substring(heap, range))
}

#[inline(always)]
fn dirname<'a, const WIN32: bool>(heap: &JsHeap<'a>, path: JsStr<'a>) -> StrResult<'a> {
    let text = path.characters(heap)?;
    match match_code_units!(text.units(), |path| platform_call!(WIN32, dirname(path))) {
        Some(end) => Ok(text.substring(heap, 0..end)),
        None => Ok(heap.create_latin1_string(b".")),
    }
}

#[inline(always)]
fn extname<'a, const WIN32: bool>(heap: &JsHeap<'a>, path: JsStr<'a>) -> StrResult<'a> {
    let text = path.characters(heap)?;
    let range = match_code_units!(text.units(), |path| platform_call!(WIN32, extname(path)));
    Ok(text.substring(heap, range))
}

#[inline(always)]
fn is_absolute<const WIN32: bool>(path: JsStr<'_>) -> bool {
    if WIN32 {
        win32::is_absolute(&path.first_characters::<3>())
    } else {
        posix::is_absolute(&path.first_characters::<1>())
    }
}

#[inline(always)]
fn parse<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    path: JsStr<'a>,
) -> bindgen::Result<'a, ParsedPath<'a>> {
    let text = path.characters(heap)?;
    let parsed = match_code_units!(text.units(), |path| platform_call!(WIN32, parse(path)));
    let [root, dir, base, ext, name] = if parsed.ext.is_empty() {
        let [root, dir, base, ext] =
            text.substrings(heap, &[parsed.root, parsed.dir, parsed.base, parsed.ext]);
        [root, dir, base, ext, base]
    } else {
        let ranges = [
            parsed.root,
            parsed.dir,
            parsed.base,
            parsed.ext,
            parsed.name,
        ];
        text.substrings(heap, &ranges)
    };
    Ok(ParsedPath {
        root,
        dir,
        base,
        ext,
        name,
    })
}

#[inline(always)]
fn normalize<'a, const WIN32: bool>(heap: &JsHeap<'a>, path: JsStr<'a>) -> StrResult<'a> {
    let text = path.characters(heap)?;
    let text = text.units();
    if match_code_units!(text, |text| platform_call!(
        WIN32,
        is_trivially_normalized(text)
    )) {
        return Ok(path);
    }
    out_of_line(|| {
        let mut scratch = Scratch::new();
        let output = match_code_units!(text, |text| platform_call!(
            WIN32,
            normalize(text, &mut scratch)
        ));
        to_js_string(heap, &[path], output.map_err(|it| to_js_error(heap, it))?)
    })
}

#[inline(always)]
fn try_join<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    paths: &[JsStr<'a>],
) -> bindgen::Result<'a, Option<JsStr<'a>>> {
    let mut buffer = StackBuffer::new();
    let output = fast_path::join::<WIN32, _>(Args { heap, paths }, &mut buffer);
    if let Some(output) = output.map_err(|error| error.into_js_error(heap))? {
        return to_js_string(heap, paths, output).map(Some);
    }
    out_of_line(|| {
        let mut scratch = Scratch::new();
        platform_call!(WIN32, join(Args { heap, paths }, &mut scratch))
            .map_err(|error| error.into_js_error(heap))?
            .map(|output| to_js_string(heap, paths, output))
            .transpose()
    })
}

#[cold]
fn join_unnormalized<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    paths: &[JsStr<'a>],
) -> StrResult<'a> {
    let mut scratch = Scratch::new();
    let output = platform_call!(WIN32, join_unnormalized(Args { heap, paths }, &mut scratch));
    to_js_string(heap, paths, output.map_err(|it| it.into_js_error(heap))?)
}

#[inline(always)]
fn join<'a, const WIN32: bool>(cx: &mut JsScope<'a>, paths: &[JsStr<'a>]) -> ValueResult<'a> {
    let platform = Platform::new(WIN32);
    let is_original = path_ffi::is_original(cx, platform, Method::Normalize);
    if !WIN32
        && is_original
        && let [path] = *paths
    {
        return normalize_posix(&cx.heap, path).map(JsLocal::as_value);
    }
    match try_join::<WIN32>(&cx.heap, paths)? {
        Some(joined) if is_original => Ok(joined.as_value()),
        Some(_) => {
            let joined = join_unnormalized::<WIN32>(&cx.heap, paths)?;
            path_ffi::call_method(cx, platform, Method::Normalize, joined)
        }
        None => join_unnormalized::<WIN32>(&cx.heap, paths).map(JsLocal::as_value),
    }
}

#[inline(always)]
fn try_relative<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    from: JsStr<'a>,
    to: JsStr<'a>,
) -> bindgen::Result<'a, Option<JsStr<'a>>> {
    let (from_text, to_text) = (from.characters(heap)?, to.characters(heap)?);
    let mut buffers = [StackBuffer::new(), StackBuffer::new()];
    if let Some(output) =
        fast_path::relative::<WIN32>(from_text.units(), to_text.units(), &mut buffers)
    {
        return to_js_string(heap, &[from, to], output).map(Some);
    }
    out_of_line(|| {
        let (args, mut scratch) = ([from, to], Scratch::new());
        let (from, to) = (from.characters(heap)?, to.characters(heap)?);
        platform_call!(WIN32, relative(from.units(), to.units(), &mut scratch))
            .map_err(|error| to_js_error(heap, error))?
            .map(|output| to_js_string(heap, &args, output))
            .transpose()
    })
}

fn relative_of_resolved<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    from: JsStr<'a>,
    to: JsStr<'a>,
) -> StrResult<'a> {
    let args = [from, to];
    let (from, to) = (from.characters(heap)?, to.characters(heap)?);
    let output = if WIN32 {
        win32::relative_of_resolved(from.units(), to.units()).map_err(|it| to_js_error(heap, it))?
    } else {
        posix::relative_of_resolved(from.units(), to.units())
    };
    to_js_string(heap, &args, output)
}

#[inline(always)]
fn relative<'a, const WIN32: bool>(
    cx: &mut JsScope<'a>,
    from: JsStr<'a>,
    to: JsStr<'a>,
) -> StrResult<'a> {
    if path_ffi::is_original(cx, Platform::new(WIN32), Method::Resolve)
        && let Some(relative) = try_relative::<WIN32>(&cx.heap, from, to)?
    {
        return Ok(relative);
    }
    out_of_line(|| {
        let empty = cx.heap.create_latin1_string(b"");
        if is_strict_equal(cx, from.as_value(), to.as_value())? {
            return Ok(empty);
        }
        let from = call_resolve::<WIN32>(cx, from)?;
        let to = call_resolve::<WIN32>(cx, to)?;
        if is_strict_equal(cx, from, to)? {
            return Ok(empty);
        }
        let (from, to) = (coerce_to_string(cx, from)?, coerce_to_string(cx, to)?);
        relative_of_resolved::<WIN32>(&cx.heap, from, to)
    })
}

#[inline(never)]
fn call_resolve<'a, const WIN32: bool>(cx: &mut JsScope<'a>, path: JsStr<'a>) -> ValueResult<'a> {
    let platform = Platform::new(WIN32);
    if path_ffi::is_original(cx, platform, Method::Resolve) {
        resolve::<WIN32>(cx, &[path.as_value()])
    } else {
        path_ffi::call_method(cx, platform, Method::Resolve, path)
    }
}

/// `resolve()`, `resolve("")` and `resolve(".")` return the cwd without normalizing it.
#[inline(always)]
fn means_cwd<'a>(heap: &JsHeap<'a>, paths: &[JsLocal<'a>]) -> bindgen::Result<'a, bool> {
    const DOT: u16 = b'.' as u16;
    let [path] = paths else {
        return Ok(paths.is_empty());
    };
    let text = path.as_string().map(|text| text.characters(heap));
    Ok(matches!(
        text.transpose()?.as_ref().map(JsCharacters::units),
        Some(CodeUnits::U8([] | [b'.']) | CodeUnits::U16([] | [DOT]))
    ))
}

/// The cwd to resolve `paths` against, if Node's call of `process.cwd()` can be skipped.
#[inline(always)]
fn cached_cwd<'h, 'a, const WIN32: bool>(
    heap: &'h JsHeap<'a>,
    paths: &[JsLocal<'a>],
) -> Result<Option<JsCharacters<'h, 'a>>, ArgError<'a>> {
    if WIN32 != HOST_IS_WIN32 || means_cwd(heap, paths)? {
        return Ok(None);
    }
    let cwd = path_ffi::cached_cwd(heap).map(|cwd| cwd.characters(heap));
    Ok(cwd.transpose()?)
}

/// `resolve`, as far as it gets without running JavaScript.
#[inline(always)]
fn resolve_step<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    paths: &[JsLocal<'a>],
) -> Result<ResolveStep<JsStr<'a>>, ArgError<'a>> {
    let mut buffer = StackBuffer::new();
    let cwd = {
        #[inline(always)]
        || cached_cwd::<WIN32>(heap, paths)
    };
    if let Some(step) = fast_path::resolve::<WIN32, _>(cwd, Args { heap, paths }, &mut buffer)? {
        return Ok(step.try_map(
            #[inline(always)]
            |output| to_js_string(heap, paths, output),
        )?);
    }
    out_of_line(|| {
        let (args, mut scratch) = (Args { heap, paths }, Scratch::new());
        let mut step = platform_call!(WIN32, resolve(None, args, &mut scratch));
        if let Ok(ResolveStep::NeedsCwd) = step
            && let Some(cwd) = cached_cwd::<WIN32>(heap, paths)?
        {
            step = platform_call!(WIN32, resolve(Some(cwd.units()), args, &mut scratch));
        }
        Ok(step?.try_map(
            #[inline(always)]
            |output| to_js_string(heap, paths, output),
        )?)
    })
}

#[inline(always)]
fn try_resolve<'a, const WIN32: bool>(heap: &JsHeap<'a>, paths: &[JsLocal<'a>]) -> ValueResult<'a> {
    match resolve_step::<WIN32>(heap, paths) {
        Ok(ResolveStep::Done(resolved)) => Ok(resolved.as_value()),
        Ok(ResolveStep::NeedsCwd) => to_js::i32(heap, !0),
        Ok(ResolveStep::NeedsDriveCwd(letter)) => to_js::i32(heap, !i32::from(letter)),
        Err(ArgError::NotAString { index }) => to_js::i32(heap, index as i32),
        Err(error) => Err(error.into_js_error(heap)),
    }
}

#[inline(never)]
fn resolve_with_cwd<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    cwd: JsStr<'a>,
    paths: &[JsLocal<'a>],
) -> StrResult<'a> {
    let (args, mut buffer) = (Args { heap, paths }, StackBuffer::new());
    let load_cwd = {
        #[inline(always)]
        || Ok(Some(cwd.characters(heap)?))
    };
    let step = fast_path::resolve::<WIN32, _>(load_cwd, args, &mut buffer);
    if let Some(step) = step.map_err(|error| error.into_js_error(heap))? {
        return to_js_string(heap, paths, step.unwrap_done());
    }
    let (cwd, mut scratch) = (cwd.characters(heap)?, Scratch::new());
    let step = platform_call!(WIN32, resolve(Some(cwd.units()), args, &mut scratch));
    let step = step.map_err(|error| error.into_js_error(heap))?;
    to_js_string(heap, paths, step.unwrap_done())
}

#[inline(always)]
fn resolve<'a, const WIN32: bool>(cx: &mut JsScope<'a>, paths: &[JsLocal<'a>]) -> ValueResult<'a> {
    match resolve_step::<WIN32>(&cx.heap, paths) {
        Ok(ResolveStep::Done(resolved)) => Ok(resolved.as_value()),
        Ok(ResolveStep::NeedsCwd) if WIN32 => resolve_win32_with_process_cwd(cx, paths),
        Ok(ResolveStep::NeedsCwd) => resolve_posix_with_process_cwd(cx, paths),
        Ok(ResolveStep::NeedsDriveCwd(letter)) => resolve_win32_with_drive_cwd(cx, paths, letter),
        Err(ArgError::NotAString { index }) => Err(path_ffi::throw_not_a_string(cx, paths, index)),
        Err(error) => Err(error.into_js_error(&cx.heap)),
    }
}

#[inline(always)]
fn posix_cwd<'a>(cx: &mut JsScope<'a>) -> ValueResult<'a> {
    let cwd = path_ffi::call_cwd(cx)?;
    if !HOST_IS_WIN32 {
        return Ok(cwd);
    }
    let cwd = coerce_to_string(cx, cwd)?;
    to_foreign_cwd(&cx.heap, cwd).map(JsLocal::as_value)
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1245-L1273>
#[inline(never)]
fn resolve_posix_with_process_cwd<'a>(
    cx: &mut JsScope<'a>,
    paths: &[JsLocal<'a>],
) -> ValueResult<'a> {
    if means_cwd(&cx.heap, paths)? {
        let cwd = posix_cwd(cx)?;
        if is_absolute_posix(coerce_to_string(cx, cwd)?) {
            return Ok(cwd);
        }
    }
    let cwd = posix_cwd(cx)?;
    let cwd = coerce_to_string(cx, cwd)?;
    resolve_with_cwd_posix(&cx.heap, cwd, paths).map(JsLocal::as_value)
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L205-L214>
#[inline(never)]
fn resolve_win32_with_process_cwd<'a>(
    cx: &mut JsScope<'a>,
    paths: &[JsLocal<'a>],
) -> ValueResult<'a> {
    let cwd = path_ffi::call_cwd(cx)?;
    if HOST_IS_WIN32 && paths.is_empty() {
        return Ok(cwd);
    }
    let cwd_string = coerce_to_string(cx, cwd)?;
    let starts_with_sep = win32::is_absolute(&cwd_string.first_characters::<1>());
    if !(paths.is_empty() || (starts_with_sep && means_cwd(&cx.heap, paths)?)) {
        resolve_with_cwd_win32(&cx.heap, cwd_string, paths).map(JsLocal::as_value)
    } else if HOST_IS_WIN32 {
        Ok(cwd)
    } else {
        to_foreign_cwd(&cx.heap, cwd_string).map(JsLocal::as_value)
    }
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L215-L231>
#[cold]
fn resolve_win32_with_drive_cwd<'a>(
    cx: &mut JsScope<'a>,
    paths: &[JsLocal<'a>],
    letter: u8,
) -> ValueResult<'a> {
    // Bun's `process.env` lacks these variables, and keeps what Node refuses to write under such a name.
    let mut cwd = if path_ffi::is_env_of_process(cx) {
        drive_cwd(&cx.heap, letter)?.map_or(JsLocal::UNDEFINED, JsLocal::as_value)
    } else {
        path_ffi::drive_cwd_from_env(cx, letter)?
    };
    if !cwd.to_js().to_boolean() {
        cwd = path_ffi::call_cwd(cx)?;
    }
    let cwd = if cwd.is_undefined() {
        cx.heap.create_latin1_string(&[letter, b':', b'\\'])
    } else {
        coerce_to_string(cx, cwd)?
    };
    resolve_with_cwd_win32(&cx.heap, cwd, paths).map(JsLocal::as_value)
}

pub(crate) fn resolve_with_real_cwd<'a>(
    cx: &mut JsScope<'a>,
    paths: &[JsLocal<'a>],
) -> StrResult<'a> {
    let heap = &cx.heap;
    let (args, mut scratch) = (Args { heap, paths }, Scratch::new());
    let drive = match platform_call!(HOST_IS_WIN32, resolve(None, args, &mut scratch)) {
        Ok(ResolveStep::Done(output)) => return to_js_string(heap, paths, output),
        Ok(ResolveStep::NeedsCwd) => None,
        Ok(ResolveStep::NeedsDriveCwd(letter)) => Some(letter),
        Err(ArgError::NotAString { index }) => {
            return Err(path_ffi::throw_not_a_string(cx, paths, index));
        }
        Err(error) => return Err(error.into_js_error(heap)),
    };
    let mut cwd = heap.create_utf8_string(utf8::real_cwd(&mut path_buffer_pool::get()))?;
    if let Some(letter) = drive
        && !win32::is_on_drive(&cwd.first_characters::<2>(), letter)
    {
        cwd = drive_cwd(heap, letter)?.unwrap_or(cwd);
    }
    resolve_with_cwd::<HOST_IS_WIN32>(heap, cwd, paths)
}

pub(crate) fn to_foreign_cwd<'a>(heap: &JsHeap<'a>, cwd: JsStr<'a>) -> StrResult<'a> {
    let mut scratch = Scratch::new();
    let foreign = match_code_units!(cwd.characters(heap)?.units(), |cwd| if HOST_IS_WIN32 {
        posix::cwd_from_win32(cwd, &mut scratch).map(PathByte::units)
    } else {
        win32::cwd_from_posix(cwd, &mut scratch).map(PathByte::units)
    });
    create_string(heap, foreign.map_err(|error| to_js_error(heap, error))?)
}

pub(crate) fn drive_cwd<'a>(
    heap: &JsHeap<'a>,
    letter: u8,
) -> bindgen::Result<'a, Option<JsStr<'a>>> {
    win32::drive_cwd(letter)
        .filter(|cwd| !cwd.is_empty())
        .map(|cwd| create_string(heap, CodeUnits::U16(&cwd)))
        .transpose()
}

#[inline(always)]
fn matches_glob<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    path: JsStr<'a>,
    pattern: JsStr<'a>,
) -> bindgen::Result<'a, bool> {
    let options = glob::Options {
        platform: Platform::new(WIN32),
        nocase: cfg!(any(windows, target_os = "macos")),
    };
    matches_glob_with_options(heap, path, pattern, options)
}

pub(crate) fn matches_glob_for_testing<'a>(
    heap: &JsHeap<'a>,
    path: JsStr<'a>,
    pattern: JsStr<'a>,
    win32: bool,
    nocase: bool,
) -> bindgen::Result<'a, bool> {
    let platform = Platform::new(win32);
    matches_glob_with_options(heap, path, pattern, glob::Options { platform, nocase })
}

fn matches_glob_with_options<'a>(
    heap: &JsHeap<'a>,
    path: JsStr<'a>,
    pattern: JsStr<'a>,
    options: glob::Options,
) -> bindgen::Result<'a, bool> {
    let (path, pattern) = (path.characters(heap)?, pattern.characters(heap)?);
    let (path, pattern) = (path.units(), pattern.units());
    let mut termination = None;
    let mut should_continue = || {
        termination = termination
            .take()
            .or_else(|| heap.check_termination().err());
        termination.is_none()
    };
    let cache = &crate::jsc_hooks::runtime_state().path_glob_cache;
    let result = (cache.borrow_mut()).matches(path, pattern, options, &mut should_continue);
    result.map_err(|error| {
        termination.unwrap_or_else(|| glob_error(heap, error, path.len(), pattern.len()))
    })
}

#[cold]
fn glob_error<'a>(
    heap: &JsHeap<'a>,
    error: glob::Error,
    path_len: usize,
    pattern_len: usize,
) -> bindgen::Error<'a> {
    match error {
        glob::Error::PatternTooLong => heap.type_error(format_args!("pattern is too long")),
        glob::Error::InvalidRegExp { message } => heap.syntax_error_from_utf16(&message),
        glob::Error::Aborted(glob::Abort::StackOverflow) => {
            heap.range_error(format_args!("Maximum call stack size exceeded"))
        }
        glob::Error::Aborted(glob::Abort::BudgetExceeded) => heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!(
                "The argument 'pattern' ({pattern_len} characters) is too complex to match against \
                 'path' ({path_len} characters)"
            ),
        ),
        glob::Error::Aborted(glob::Abort::Memory(error)) => to_js_error(heap, error),
        glob::Error::Aborted(glob::Abort::Terminated) => {
            unreachable!("the termination is thrown in its place")
        }
    }
}

macro_rules! on_both_platforms {
    ($( $posix:ident, $win32:ident = $body:ident($($parameter:ident: $type:ty),*) -> $result:ty; )*) => {$(
        #[inline(always)]
        pub(crate) fn $posix<'a>($($parameter: $type),*) -> $result {
            $body::<false>($($parameter),*)
        }
        #[inline(always)]
        pub(crate) fn $win32<'a>($($parameter: $type),*) -> $result {
            $body::<true>($($parameter),*)
        }
    )*};
}
on_both_platforms! {
    basename_posix, basename_win32 = basename(heap: &JsHeap<'a>, path: JsStr<'a>, suffix: Option<JsStr<'a>>) -> StrResult<'a>;
    dirname_posix, dirname_win32 = dirname(heap: &JsHeap<'a>, path: JsStr<'a>) -> StrResult<'a>;
    extname_posix, extname_win32 = extname(heap: &JsHeap<'a>, path: JsStr<'a>) -> StrResult<'a>;
    is_absolute_posix, is_absolute_win32 = is_absolute(path: JsStr<'a>) -> bool;
    join_posix, join_win32 = join(cx: &mut JsScope<'a>, paths: &[JsStr<'a>]) -> ValueResult<'a>;
    join_unnormalized_posix, join_unnormalized_win32 = join_unnormalized(heap: &JsHeap<'a>, paths: &[JsStr<'a>]) -> StrResult<'a>;
    matches_glob_posix, matches_glob_win32 = matches_glob(heap: &JsHeap<'a>, path: JsStr<'a>, pattern: JsStr<'a>) -> bindgen::Result<'a, bool>;
    normalize_posix, normalize_win32 = normalize(heap: &JsHeap<'a>, path: JsStr<'a>) -> StrResult<'a>;
    parse_posix, parse_win32 = parse(heap: &JsHeap<'a>, path: JsStr<'a>) -> bindgen::Result<'a, ParsedPath<'a>>;
    relative_posix, relative_win32 = relative(cx: &mut JsScope<'a>, from: JsStr<'a>, to: JsStr<'a>) -> StrResult<'a>;
    relative_of_resolved_posix, relative_of_resolved_win32 = relative_of_resolved(heap: &JsHeap<'a>, from: JsStr<'a>, to: JsStr<'a>) -> StrResult<'a>;
    resolve_posix, resolve_win32 = resolve(cx: &mut JsScope<'a>, paths: &[JsLocal<'a>]) -> ValueResult<'a>;
    resolve_with_cwd_posix, resolve_with_cwd_win32 = resolve_with_cwd(heap: &JsHeap<'a>, cwd: JsStr<'a>, paths: &[JsLocal<'a>]) -> StrResult<'a>;
    try_join_posix, try_join_win32 = try_join(heap: &JsHeap<'a>, paths: &[JsStr<'a>]) -> bindgen::Result<'a, Option<JsStr<'a>>>;
    try_relative_posix, try_relative_win32 = try_relative(heap: &JsHeap<'a>, from: JsStr<'a>, to: JsStr<'a>) -> bindgen::Result<'a, Option<JsStr<'a>>>;
    try_resolve_posix, try_resolve_win32 = try_resolve(heap: &JsHeap<'a>, paths: &[JsLocal<'a>]) -> ValueResult<'a>;
}
