//! The bodies of node_path.bind.ts.
#![forbid(unsafe_code)]

use core::cell::RefCell;

use crate::generated_bindgen::node_path::ParsedPath;
use crate::jsc::bindgen::{self, JsHeap, JsLocal, to_js};
use crate::jsc::{ErrorCode, JSString};
use bun_core::strings::PathByte;
use bun_node_path::{
    Answer, CodeUnits, Failure, Paths, Resolved, Scratch, glob, posix, short, win32,
};

type Text<'a> = JsLocal<'a, JSString>;
type TextResult<'a> = bindgen::Result<'a, Text<'a>>;

/// Keeps what most calls do not need out of the function that all of them enter.
#[inline(never)]
fn out_of_line<R>(body: impl FnOnce() -> R) -> R {
    body()
}

/// `$body` for whichever slice `$text` holds.
macro_rules! of_either_width {
    ($text:expr, |$units:ident| $body:expr) => {
        match $text {
            CodeUnits::U8($units) => $body,
            CodeUnits::U16($units) => out_of_line(|| $body),
        }
    };
}

/// The function `$name` of `posix` or of `win32`.
macro_rules! of_platform {
    ($name:ident($($argument:expr),*)) => {
        if WIN32 {
            win32::$name($($argument),*)
        } else {
            posix::$name($($argument),*)
        }
    };
}

enum Stop<'a> {
    Failed(Failure),
    Threw(bindgen::Error<'a>),
    /// The index of the argument.
    NotAString(usize),
}

impl From<Failure> for Stop<'_> {
    fn from(failure: Failure) -> Self {
        Stop::Failed(failure)
    }
}

#[cold]
fn error_of<'a>(heap: &JsHeap<'a>, failure: Failure) -> bindgen::Error<'a> {
    match failure {
        Failure::TooLong => heap.invalid_string_length(),
        Failure::OutOfMemory => bun_core::AllocError.into(),
    }
}

impl<'a> Stop<'a> {
    /// The error to throw, or the index of what is no string.
    #[cold]
    fn into_result(self, heap: &JsHeap<'a>) -> bindgen::Result<'a, usize> {
        match self {
            Stop::Failed(failure) => Err(error_of(heap, failure)),
            Stop::Threw(error) => Err(error),
            Stop::NotAString(index) => Ok(index),
        }
    }

    #[cold]
    fn into_error(self, heap: &JsHeap<'a>) -> bindgen::Error<'a> {
        self.into_result(heap)
            .expect_err("every argument is a string")
    }
}

/// An argument that is a string, or may be.
trait Operand<'a>: Copy {
    fn as_text(self) -> Option<Text<'a>>;
}

impl<'a> Operand<'a> for Text<'a> {
    #[inline(always)]
    fn as_text(self) -> Option<Text<'a>> {
        Some(self)
    }
}

impl<'a> Operand<'a> for JsLocal<'a> {
    #[inline(always)]
    fn as_text(self) -> Option<Text<'a>> {
        self.as_string()
    }
}

#[derive(Clone, Copy)]
struct Operands<'h, 'a, T> {
    heap: &'h JsHeap<'a>,
    values: &'h [T],
}

impl<'h, 'a, T: Operand<'a>> Paths<'h> for Operands<'h, 'a, T> {
    type Error = Stop<'a>;

    #[inline(always)]
    fn count(self) -> usize {
        self.values.len()
    }

    #[inline(always)]
    fn get(self, index: usize) -> Result<CodeUnits<'h>, Stop<'a>> {
        let text = self.values[index].as_text();
        let text = text.ok_or(Stop::NotAString(index))?;
        Ok(text.characters(self.heap).map_err(Stop::Threw)?.units())
    }
}

/// `answer` as a string. `operands` are those of the function that gave it.
#[inline(always)]
fn string_of<'a>(
    heap: &JsHeap<'a>,
    operands: &[impl Operand<'a>],
    answer: Answer<'_>,
) -> TextResult<'a> {
    let operand = |index: usize| {
        let text = operands[index].as_text();
        text.expect("its characters have been read")
    };
    match answer {
        Answer::Operand(index) => Ok(operand(index)),
        Answer::Part(index, range) => Ok(operand(index).characters(heap)?.substring(heap, range)),
        Answer::Text(text) => heap.create_string_of(text),
        Answer::Upwards(upwards) if upwards.is_wide() => out_of_line(|| {
            let mut scratch = Scratch::new();
            let text = upwards.written(&mut scratch);
            heap.create_string_of(CodeUnits::U16(text.map_err(|it| error_of(heap, it))?))
        }),
        Answer::Upwards(upwards) => {
            heap.create_latin1_string_with(upwards.len(), |to| upwards.write(to))
        }
    }
}

#[inline(always)]
fn basename<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
    suffix: Option<Text<'a>>,
) -> TextResult<'a> {
    let text = path.characters(heap)?;
    let range = match suffix {
        None => of_either_width!(text.units(), |path| of_platform!(basename(path))),
        Some(suffix) => {
            let suffix = suffix.characters(heap)?.units();
            of_either_width!(text.units(), |path| of_either_width!(suffix, |suffix| {
                of_platform!(basename_without(path, suffix))
            }))
        }
    };
    Ok(text.substring(heap, range))
}

#[inline(always)]
fn dirname<'a, const WIN32: bool>(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a> {
    let text = path.characters(heap)?;
    match of_either_width!(text.units(), |path| of_platform!(dirname(path))) {
        Some(end) => Ok(text.substring(heap, 0..end)),
        None => Ok(heap.create_latin1_string(b".")),
    }
}

#[inline(always)]
fn extname<'a, const WIN32: bool>(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a> {
    let text = path.characters(heap)?;
    let range = of_either_width!(text.units(), |path| of_platform!(extname(path)));
    Ok(text.substring(heap, range))
}

#[inline(always)]
fn is_absolute<const WIN32: bool>(path: Text<'_>) -> bool {
    if WIN32 {
        win32::is_absolute(&path.first_characters::<3>())
    } else {
        posix::is_absolute(&path.first_characters::<1>())
    }
}

#[inline(always)]
fn parse<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, ParsedPath<'a>> {
    let text = path.characters(heap)?;
    let parsed = of_either_width!(text.units(), |path| of_platform!(parse(path)));
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
fn normalize<'a, const WIN32: bool>(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a> {
    let text = path.characters(heap)?.units();
    if of_either_width!(text, |text| of_platform!(is_normalized(text))) {
        return Ok(path);
    }
    if let CodeUnits::U8([]) = text {
        return Ok(heap.create_latin1_string(b"."));
    }
    out_of_line(|| {
        let mut scratch = Scratch::new();
        let answer = of_either_width!(text, |text| of_platform!(normalize(text, &mut scratch)));
        string_of(heap, &[path], answer.map_err(|it| error_of(heap, it))?)
    })
}

#[inline(always)]
fn join<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    values: &[Text<'a>],
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let latin1 = values.iter().map(|path| path.latin1(heap));
    if let Some(joined) = short::join::<WIN32>(latin1, &mut short::Buffer::new()) {
        return heap.create_string_of(CodeUnits::U8(joined)).map(Some);
    }
    out_of_line(|| {
        let mut scratch = Scratch::new();
        of_platform!(join(Operands { heap, values }, &mut scratch))
            .map_err(|stop| stop.into_error(heap))?
            .map(|answer| string_of(heap, values, answer))
            .transpose()
    })
}

fn concatenate<'a, const WIN32: bool>(heap: &JsHeap<'a>, values: &[Text<'a>]) -> TextResult<'a> {
    let mut scratch = Scratch::new();
    let answer = of_platform!(concatenate(Operands { heap, values }, &mut scratch));
    string_of(heap, values, answer.map_err(|stop| stop.into_error(heap))?)
}

#[inline(always)]
fn relative<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let mut buffers = [short::Buffer::new(), short::Buffer::new()];
    if let (Some(latin1_from), Some(latin1_to)) = (from.latin1(heap), to.latin1(heap))
        && let Some(answer) = short::relative::<WIN32>(latin1_from, latin1_to, &mut buffers)
    {
        return string_of(heap, &[from, to], answer).map(Some);
    }
    out_of_line(|| {
        let (values, mut scratch) = ([from, to], Scratch::new());
        let (from, to) = (from.characters(heap)?.units(), to.characters(heap)?.units());
        of_platform!(relative(from, to, &mut scratch))
            .map_err(|failure| error_of(heap, failure))?
            .map(|answer| string_of(heap, &values, answer))
            .transpose()
    })
}

fn relative_of_resolved<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> TextResult<'a> {
    let values = [from, to];
    let (from, to) = (from.characters(heap)?.units(), to.characters(heap)?.units());
    let answer = of_platform!(relative_of_resolved(from, to));
    string_of(heap, &values, answer.map_err(|it| error_of(heap, it))?)
}

#[inline(always)]
fn value_of<'a>(
    heap: &JsHeap<'a>,
    values: &[JsLocal<'a>],
    resolved: Resolved<'_>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    match resolved {
        Resolved::Answer(answer) => string_of(heap, values, answer).map(JsLocal::as_value),
        Resolved::Needs(drive) => to_js::i32(heap, -i32::from(drive.unwrap_or(1))),
    }
}

#[inline(always)]
fn resolve<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    values: &[JsLocal<'a>],
) -> bindgen::Result<'a, JsLocal<'a>> {
    let latin1 = |index: usize| values[index].as_string()?.latin1(heap);
    let mut buffer = short::Buffer::new();
    if let Some(resolved) = short::resolve::<WIN32>(None, values.len(), latin1, &mut buffer) {
        return value_of(heap, values, resolved);
    }
    out_of_line(|| {
        let mut scratch = Scratch::new();
        match of_platform!(resolve(None, Operands { heap, values }, &mut scratch)) {
            Ok(resolved) => value_of(heap, values, resolved),
            Err(stop) => to_js::i32(heap, stop.into_result(heap)? as i32),
        }
    })
}

#[inline(always)]
fn resolve_from<'a, const WIN32: bool>(
    heap: &JsHeap<'a>,
    directory: Text<'a>,
    values: &[Text<'a>],
) -> TextResult<'a> {
    let latin1 = |index: usize| values[index].latin1(heap);
    let mut buffer = short::Buffer::new();
    if let directory @ Some(_) = directory.latin1(heap)
        && let Some(Resolved::Answer(answer)) =
            short::resolve::<WIN32>(directory, values.len(), latin1, &mut buffer)
    {
        return string_of(heap, values, answer);
    }
    out_of_line(|| {
        let (directory, mut scratch) = (Some(directory.characters(heap)?.units()), Scratch::new());
        let values = JsLocal::as_values(values);
        match of_platform!(resolve(directory, Operands { heap, values }, &mut scratch)) {
            Ok(Resolved::Answer(answer)) => string_of(heap, values, answer),
            Ok(Resolved::Needs(_)) => unreachable!("it has been given what it needs"),
            Err(stop) => Err(stop.into_error(heap)),
        }
    })
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
    basename_posix, basename_win32 = basename(heap: &JsHeap<'a>, path: Text<'a>, suffix: Option<Text<'a>>) -> TextResult<'a>;
    concatenate_posix, concatenate_win32 = concatenate(heap: &JsHeap<'a>, paths: &[Text<'a>]) -> TextResult<'a>;
    dirname_posix, dirname_win32 = dirname(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a>;
    extname_posix, extname_win32 = extname(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a>;
    is_absolute_posix, is_absolute_win32 = is_absolute(path: Text<'a>) -> bool;
    join_posix, join_win32 = join(heap: &JsHeap<'a>, paths: &[Text<'a>]) -> bindgen::Result<'a, Option<Text<'a>>>;
    normalize_posix, normalize_win32 = normalize(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a>;
    parse_posix, parse_win32 = parse(heap: &JsHeap<'a>, path: Text<'a>) -> bindgen::Result<'a, ParsedPath<'a>>;
    relative_posix, relative_win32 = relative(heap: &JsHeap<'a>, from: Text<'a>, to: Text<'a>) -> bindgen::Result<'a, Option<Text<'a>>>;
    relative_of_resolved_posix, relative_of_resolved_win32 = relative_of_resolved(heap: &JsHeap<'a>, from: Text<'a>, to: Text<'a>) -> TextResult<'a>;
    resolve_posix, resolve_win32 = resolve(heap: &JsHeap<'a>, paths: &[JsLocal<'a>]) -> bindgen::Result<'a, JsLocal<'a>>;
    resolve_from_posix, resolve_from_win32 = resolve_from(heap: &JsHeap<'a>, directory: Text<'a>, paths: &[Text<'a>]) -> TextResult<'a>;
}

pub(crate) fn respell<'a>(heap: &JsHeap<'a>, directory: Text<'a>, win32: bool) -> TextResult<'a> {
    let mut scratch = Scratch::new();
    let text = of_either_width!(directory.characters(heap)?.units(), |directory| {
        bun_node_path::respell(directory, win32, &mut scratch).map(PathByte::units)
    });
    heap.create_string_of(text.map_err(|failure| error_of(heap, failure))?)
}

pub(crate) fn working_directory_of_drive<'a>(
    heap: &JsHeap<'a>,
    letter: u8,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    win32::working_directory_of_drive(letter)
        .map(|directory| heap.create_string_of(CodeUnits::U16(&directory)))
        .transpose()
}

thread_local! {
    static PATTERNS: RefCell<glob::Cache> = const { RefCell::new(glob::Cache::new()) };
}

pub(crate) fn matches_glob<'a>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
    pattern: Text<'a>,
    win32: bool,
    ignores_case: bool,
) -> bindgen::Result<'a, bool> {
    let (path, pattern) = (path.characters(heap)?, pattern.characters(heap)?);
    let options = glob::Options {
        win32,
        ignores_case,
    };
    let mut termination = None;
    let mut goes_on = || {
        termination = heap.check_termination().err();
        termination.is_none()
    };
    PATTERNS
        .with_borrow_mut(|it| it.matches(path.units(), pattern.units(), options, &mut goes_on))
        .map_err(|error| termination.unwrap_or_else(|| glob_error(heap, error)))
}

#[cold]
fn glob_error<'a>(heap: &JsHeap<'a>, error: glob::Error) -> bindgen::Error<'a> {
    match error {
        glob::Error::TooLong => heap.type_error(format_args!("pattern is too long")),
        glob::Error::Syntax(message) => heap.syntax_error_from_utf16(&message),
        glob::Error::Stopped(glob::Stop::TooDeep) => {
            heap.range_error(format_args!("Maximum call stack size exceeded"))
        }
        glob::Error::Stopped(glob::Stop::TooComplex) => heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!("The argument 'pattern' is too complex"),
        ),
        glob::Error::Stopped(glob::Stop::OutOfMemory) => bun_core::AllocError.into(),
        glob::Error::Stopped(glob::Stop::Interrupted) => {
            unreachable!("the termination is thrown in its place")
        }
    }
}
