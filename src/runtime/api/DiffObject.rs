use core::ops::Range;
use std::borrow::Cow;

use bun_core::String;
use bun_core::strings::{CodeUnits, copy_u16_into_u8};
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::{
    ErrorCode, JSArray, JSArrayIterator, JSGlobalObject, JSMap, JSValue, JsResult,
    MarkedArgumentBuffer,
};
use bun_text_diff::patch;
use bun_text_diff::tokens::{
    Edit, Ignore, Split, Unit, diff_ids, diff_text_ignoring, strip_trailing_cr,
};

use crate::generated_bindgen::diff_object::{
    ApplyOptions, ArrayChange, Change, FilePatch, FileToApply, Hunk, HunkToApply, HunksOptions,
    LinesOptions, Options, PatchOptions, PatchToApply, TextOptions,
};

trait JsUnit: Unit {
    fn of(string: &String) -> Cow<'_, [Self]>;
    /// `operation`, which is ASCII, and then `text`. If there is no memory, a string that throws when it is converted.
    fn line(operation: u8, text: &[Self]) -> String;
}
impl JsUnit for u8 {
    fn of(string: &String) -> Cow<'_, [u8]> {
        Cow::Borrowed(string.latin1())
    }
    fn line(operation: u8, text: &[u8]) -> String {
        let (line, units) = String::create_uninitialized_latin1(1 + text.len());
        if let [first, rest @ ..] = units {
            *first = operation;
            rest.copy_from_slice(text);
        }
        line
    }
}
impl JsUnit for u16 {
    fn of(string: &String) -> Cow<'_, [u16]> {
        if string.is_utf16() {
            Cow::Borrowed(string.utf16())
        } else {
            Cow::Owned(string.latin1().iter().map(|&unit| unit.into()).collect())
        }
    }
    fn line(operation: u8, text: &[u16]) -> String {
        // ASCII is stored as Latin-1, as in `String::clone_utf16`. A loop without an early exit is vectorized.
        if text.iter().fold(0, |all, &unit| all | unit) < 0x80 {
            let (line, units) = String::create_uninitialized_latin1(1 + text.len());
            if let [first, rest @ ..] = units {
                *first = operation;
                copy_u16_into_u8(rest, text);
            }
            return line;
        }
        let (line, units) = String::create_uninitialized_utf16(1 + text.len());
        if let [first, rest @ ..] = units {
            *first = operation.into();
            rest.copy_from_slice(text);
        }
        line
    }
}

/// `$function::<u16>(..)` if any of `$strings` is UTF-16, and `$function::<u8>(..)` if none is.
macro_rules! by_width {
    ($strings:expr, $function:ident($($argument:expr),*)) => {
        if $strings.into_iter().any(String::is_utf16) {
            $function::<u16>($($argument),*)
        } else {
            $function::<u8>($($argument),*)
        }
    };
}

fn clone_units<T: Unit>(units: &[T]) -> String {
    match T::units(units) {
        CodeUnits::U8(latin1) => String::clone_latin1(latin1),
        CodeUnits::U16(utf16) => String::clone_utf16(utf16),
    }
}

fn limit<'a>(heap: &JsHeap<'a>, name: &str, value: f64) -> bindgen::Result<'a, usize> {
    if value >= 0.0 && value.trunc() == value {
        return Ok(value as usize);
    }
    Err(heap.error_with_code(
        ErrorCode::OUT_OF_RANGE,
        format_args!(
            "The value of \"options.{name}\" is out of range. It must be an integer >= 0 or Infinity. Received {}",
            bun_core::fmt::double(value)
        ),
    ))
}

#[cold]
fn unsupported<'a>(heap: &JsHeap<'a>, options: &[(&str, bool)]) -> bindgen::Error<'a> {
    let (name, _) = options.iter().find(|it| it.1).copied().unwrap_or_default();
    heap.error_with_code(
        ErrorCode::INVALID_ARG_VALUE,
        format_args!("The property 'options.{name}' is not supported"),
    )
}

macro_rules! refuse {
    ($heap:expr, $($name:literal: $is_set:expr),*) => {
        if $($is_set)|* {
            return Err(unsupported($heap, &[$(($name, $is_set)),*]));
        }
    };
}

/// Reads the options of all functions that compare.
macro_rules! max_edits {
    ($heap:expr, $options:expr, $($refused:tt)*) => {{
        refuse!(
            $heap,
            "timeout": $options.timeout,
            "callback": $options.callback,
            "comparator": $options.comparator,
            "oneChangePerToken": $options.one_change_per_token,
            $($refused)*
        );
        let max = $options.max_edit_length.unwrap_or(f64::INFINITY);
        limit($heap, "maxEditLength", max)?
    }};
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Kept,
    Removed,
    Added,
}

/// `range` is in the old input if the run is removed, and in the new one if not.
struct Run {
    kind: Kind,
    range: Range<usize>,
    count: usize,
}

/// `kept_at_end` counts the tokens from the end of the last edit to `new_length`.
fn runs(
    edits: impl Iterator<Item = Edit>,
    new_length: usize,
    kept_at_end: impl FnOnce(usize) -> usize,
) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut push = |kind, range: Range<usize>, count| {
        if count > 0 {
            runs.push(Run { kind, range, count });
        }
    };
    let (mut unit, mut token) = (0, 0);
    for Edit { units, tokens } in edits {
        push(Kind::Kept, unit..units.b_lo, tokens.b_lo - token);
        push(Kind::Removed, units.a_lo..units.a_hi, tokens.deleted());
        push(Kind::Added, units.b_lo..units.b_hi, tokens.inserted());
        (unit, token) = (units.b_hi, tokens.b_hi);
    }
    push(Kind::Kept, unit..new_length, kept_at_end(unit));
    runs
}

/// The options of all functions that compare text.
#[derive(Clone, Copy)]
struct Compare {
    ignore: Ignore,
    max_edits: usize,
}

impl Compare {
    fn diff<T: Unit>(self, split: Split, a: &[T], b: &[T]) -> Option<Vec<Edit>> {
        diff_text_ignoring(split, a, b, self.ignore, self.max_edits)
    }
}

macro_rules! compare_lines {
    ($heap:expr, $options:expr) => {
        Compare {
            ignore: Ignore {
                case: $options.ignore_case,
                whitespace: $options.ignore_whitespace,
            },
            max_edits: max_edits!(
                $heap,
                $options,
                "newlineIsToken": $options.newline_is_token,
                "ignoreNewlineAtEof": $options.ignore_newline_at_eof
            ),
        }
    };
}

/// The old one and the new one.
struct Texts<'s> {
    given: [&'s String; 2],
    without_cr: Option<Box<[String; 2]>>,
}

impl<'s> Texts<'s> {
    #[inline]
    fn new<'a>(
        heap: &JsHeap<'a>,
        given: [&'s String; 2],
        strip_trailing_cr: bool,
    ) -> bindgen::Result<'a, Self> {
        let without_cr = match strip_trailing_cr {
            true => Some(without_cr(given).ok_or_else(|| heap.memory_allocation_failed())?),
            false => None,
        };
        Ok(Self { given, without_cr })
    }

    #[inline]
    fn get(&self) -> [&String; 2] {
        (self.without_cr.as_ref()).map_or(self.given, |texts| texts.each_ref())
    }
}

#[cold]
fn without_cr(texts: [&String; 2]) -> Option<Box<[String; 2]>> {
    let texts = texts.map(|text| {
        let stripped = if text.is_utf16() {
            strip_trailing_cr(text.utf16()).map(|it| clone_units(&it))
        } else {
            strip_trailing_cr(text.latin1()).map(|it| clone_units(&it))
        };
        stripped.unwrap_or_else(|| text.clone())
    });
    (!texts.iter().any(String::is_dead)).then(|| Box::new(texts))
}

#[inline(never)]
fn text_runs<T: JsUnit>(
    split: Split,
    old: &String,
    new: &String,
    compare: Compare,
) -> Option<Vec<Run>> {
    let (a, b) = (T::of(old), T::of(new));
    let edits = compare.diff(split, &a, &b)?;
    let kept_at_end = |from| split.count(&b[from..]);
    Some(runs(edits.into_iter(), b.len(), kept_at_end))
}

#[inline(always)]
fn changes<'s>(
    split: Split,
    texts: Texts<'s>,
    compare: Compare,
) -> Option<impl Iterator<Item = Change> + use<'s>> {
    let [old, new] = texts.get();
    let runs = by_width!([old, new], text_runs(split, old, new, compare));
    let change = move |Run { kind, range, count }| Change {
        value: texts.get()[usize::from(kind != Kind::Removed)].shared_substring(range),
        added: kind == Kind::Added,
        removed: kind == Kind::Removed,
        count,
    };
    Some(runs?.into_iter().map(change))
}

pub(crate) fn lines<'a, 's>(
    heap: &JsHeap<'a>,
    old: &'s String,
    new: &'s String,
    options: &LinesOptions,
) -> bindgen::Result<'a, Option<impl Iterator<Item = Change> + use<'s>>> {
    let compare = compare_lines!(heap, options);
    let texts = Texts::new(heap, [old, new], options.strip_trailing_cr)?;
    Ok(changes(Split::Lines, texts, compare))
}

macro_rules! split_by {
    ($($name:ident: $split:expr;)*) => {$(
        pub(crate) fn $name<'a, 's>(
            heap: &JsHeap<'a>,
            old: &'s String,
            new: &'s String,
            options: &TextOptions,
        ) -> bindgen::Result<'a, Option<impl Iterator<Item = Change> + use<'s>>> {
            let ignore = Ignore { case: options.ignore_case, whitespace: false };
            let max_edits = max_edits!(heap, options, "intlSegmenter": options.intl_segmenter);
            Ok(changes($split, Texts::new(heap, [old, new], false)?, Compare { ignore, max_edits }))
        }
    )*};
}
split_by! {
    words: Split::Words;
    chars: Split::Chars;
}

/// `MAX_STORAGE_VECTOR_LENGTH`. Asking for a longer array with every element in place ends the process.
const MAX_COPY_LENGTH: u32 = 1 << 28;

/// Numbers values so that two have the same number if they are `===`.
struct ValueIds {
    map: JSValue,
    distinct: u32,
}

impl ValueIds {
    /// The number of each element. The elements go into `copy`, which is empty, because a getter can change `array`.
    fn read(
        &mut self,
        global: &JSGlobalObject,
        array: JSValue,
        copy: &mut MarkedArgumentBuffer,
    ) -> JsResult<Vec<u32>> {
        let Some(map) = JSMap::from_js(self.map) else {
            return Err(global.throw_out_of_memory());
        };
        let map = JSMap::opaque_mut(map.as_ptr());
        let mut elements = JSArrayIterator::init(array, global)?;
        if elements.len > MAX_COPY_LENGTH {
            return Err(global.throw_out_of_memory());
        }
        let mut ids = Vec::new();
        while let Some(element) = elements.next()? {
            copy.append(element);
            if copy.size() == ids.len() {
                return Err(global.throw_out_of_memory());
            }
            // To a `Map`, NaN is the same as NaN.
            let is_nan = element.is_number() && element.as_number().is_nan();
            if !is_nan {
                let known = map.get(global, element)?;
                if known.is_number() {
                    ids.push(known.as_number() as u32);
                    continue;
                }
                map.set(global, element, JSValue::js_number(self.distinct.into()))?;
            }
            ids.push(self.distinct);
            self.distinct += 1;
        }
        Ok(ids)
    }
}

fn array_changes<'a>(
    cx: &mut JsScope<'a>,
    (old, old_copy): (JSValue, &mut MarkedArgumentBuffer),
    (new, new_copy): (JSValue, &mut MarkedArgumentBuffer),
    max_edits: usize,
) -> bindgen::Result<'a, Option<JsLocal<'a, JSArray>>> {
    let global = cx.global();
    let mut ids = ValueIds {
        map: JSMap::create(global),
        distinct: 0,
    };
    let a = ids.read(global, old, old_copy)?;
    let b = ids.read(global, new, new_copy)?;
    ids.map.ensure_still_alive();

    let Some(hunks) = diff_ids(&a, &b, ids.distinct as usize, max_edits) else {
        return Ok(None);
    };
    let edits = hunks.into_iter().map(|hunk| Edit {
        units: hunk,
        tokens: hunk,
    });
    let runs = runs(edits, b.len(), |from| b.len() - from);
    let (old, new) = (&*old_copy, &*new_copy);
    let changes = cx.heap.create_array(runs, |heap, run| {
        let Run { kind, range, count } = run;
        let from = if kind == Kind::Removed { old } else { new };
        let change = ArrayChange {
            value: heap.create_array_of(from, range)?,
            added: kind == Kind::Added,
            removed: kind == Kind::Removed,
            count,
        };
        change.into_js(heap)
    })?;
    Ok(Some(changes))
}

pub(crate) fn arrays<'a>(
    cx: &mut JsScope<'a>,
    old: JsLocal<'a, JSArray>,
    new: JsLocal<'a, JSArray>,
    options: &Options,
) -> bindgen::Result<'a, Option<JsLocal<'a, JSArray>>> {
    let max_edits = max_edits!(&cx.heap, options, "ignoreCase": options.ignore_case);
    MarkedArgumentBuffer::new(|old_copy| {
        MarkedArgumentBuffer::new(|new_copy| {
            let (old, new) = ((old.to_js(), old_copy), (new.to_js(), new_copy));
            array_changes(cx, old, new, max_edits)
        })
    })
}

fn hunk_with<L>(hunk: patch::PatchHunk<L>, line: impl FnMut(L) -> String) -> Hunk {
    Hunk {
        old_start: hunk.old_start,
        old_lines: hunk.old_lines,
        new_start: hunk.new_start,
        new_lines: hunk.new_lines,
        lines: hunk.lines.into_iter().map(line).collect(),
    }
}

fn hunks_of<T: JsUnit>(
    old: &String,
    new: &String,
    context: usize,
    compare: Compare,
) -> Option<Vec<Hunk>> {
    let (a, b) = (T::of(old), T::of(new));
    let edits = compare.diff(Split::Lines, &a, &b)?;
    let hunks = patch::hunks(&a, &b, &edits, context).map(|hunk| {
        hunk_with(hunk, |line| match line {
            patch::Line::Text(operation, text) => T::line(operation, text),
            patch::Line::NoNewline => String::clone_latin1(patch::NO_NEWLINE),
        })
    });
    Some(hunks.collect())
}

pub(crate) fn hunks<'a>(
    heap: &JsHeap<'a>,
    old: &String,
    new: &String,
    options: &HunksOptions,
) -> bindgen::Result<'a, Option<Vec<Hunk>>> {
    let context = limit(heap, "context", options.context)?;
    let compare = compare_lines!(heap, options);
    let texts = Texts::new(heap, [old, new], options.strip_trailing_cr)?;
    let [old, new] = texts.get();
    Ok(by_width!([old, new], hunks_of(old, new, context, compare)))
}

struct FileHeader<'a> {
    marker: &'static [u8],
    name: &'a [u8],
    header: &'a String,
}

fn format_patch<T: JsUnit>(
    old: &String,
    new: &String,
    headers: &[FileHeader<'_>],
    context: usize,
    compare: Compare,
) -> Option<String> {
    let (a, b) = (T::of(old), T::of(new));
    let edits = compare.diff(Split::Lines, &a, &b)?;
    let mut out = Vec::new();
    // As `diff -u`: no differences, no output.
    if !edits.is_empty() {
        for file in headers {
            patch::write_file_header(&mut out, file.marker, file.name, &T::of(file.header));
        }
    }
    for hunk in patch::hunks(&a, &b, &edits, context) {
        patch::write_hunk(&mut out, &hunk);
    }
    Some(clone_units(&out))
}

fn has_line_break(string: &String) -> bool {
    (0..string.length()).any(|at| matches!(string.char_at(at), 0x0A | 0x0D))
}

pub(crate) fn create_patch<'a>(
    heap: &JsHeap<'a>,
    old: &String,
    new: &String,
    options: &PatchOptions<'_>,
) -> bindgen::Result<'a, Option<String>> {
    refuse!(heap, "headerOptions": options.header_options);
    let context = limit(heap, "context", options.context)?;
    let compare = compare_lines!(heap, options);
    let texts = Texts::new(heap, [old, new], options.strip_trailing_cr)?;
    let [old, new] = texts.get();
    let (old_name, new_name) = (options.old_file_name, options.new_file_name);
    let mut headers = Vec::new();
    for (marker, name, option, header) in [
        (
            b"--- ",
            old_name.or(new_name),
            "oldHeader",
            &options.old_header,
        ),
        (
            b"+++ ",
            new_name.or(old_name),
            "newHeader",
            &options.new_header,
        ),
    ] {
        let invalid = |reason: &str| {
            heap.error_with_code(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("The property 'options.{option}' {reason}"),
            )
        };
        if header.as_ref().is_some_and(has_line_break) {
            return Err(invalid("must not contain a line break"));
        }
        match (name, header) {
            (Some(name), header) => headers.push(FileHeader {
                marker,
                name,
                header: header.as_ref().unwrap_or(const { &String::EMPTY }),
            }),
            (None, Some(_)) => {
                return Err(invalid(
                    "requires 'options.oldFileName' or 'options.newFileName'",
                ));
            }
            (None, None) => {}
        }
    }
    let strings = headers.iter().map(|file| file.header).chain([old, new]);
    Ok(by_width!(
        strings,
        format_patch(old, new, &headers, context, compare)
    ))
}

/// The lines of the hunks are places in `text` as it is afterwards.
fn parse<'a, T: Unit>(
    heap: &JsHeap<'a>,
    text: &mut Cow<'_, [T]>,
) -> bindgen::Result<'a, Vec<patch::FilePatch>> {
    let files = patch::parse(text).map_err(|error| heap.syntax_error(format_args!("{error}")))?;
    if files.last().is_some_and(|file| file.lost_cr) {
        text.to_mut().push(T::from_u8(b'\r'));
    }
    Ok(files)
}

fn parse_string<'a, T: JsUnit>(
    heap: &JsHeap<'a>,
    text: &String,
) -> bindgen::Result<'a, (String, Vec<patch::FilePatch>)> {
    let mut units = T::of(text);
    let files = parse(heap, &mut units)?;
    if units.len() == text.length() {
        return Ok((text.clone(), files));
    }
    if units.len() > String::max_length() {
        return Err(heap.string_too_long());
    }
    let restored = clone_units(&units);
    if restored.is_dead() {
        return Err(heap.memory_allocation_failed());
    }
    Ok((restored, files))
}

pub(crate) fn parse_patch<'a>(
    heap: &JsHeap<'a>,
    text: &String,
) -> bindgen::Result<'a, impl Iterator<Item = FilePatch> + use<>> {
    let (text, files) = by_width!([text], parse_string(heap, text))?;
    let name = |name: Option<patch::Name>| name.map(|name| String::clone_utf16(&name));
    let flag = |is_set: bool| is_set.then_some(true);
    let hunk = move |hunk| hunk_with(hunk, |line| text.shared_substring(line));
    Ok(files.into_iter().map(move |file| FilePatch {
        index: name(file.index),
        old_file_name: name(file.old_file_name),
        old_header: name(file.old_header),
        new_file_name: name(file.new_file_name),
        new_header: name(file.new_header),
        old_mode: name(file.old_mode),
        new_mode: name(file.new_mode),
        is_git: flag(file.is_git),
        is_rename: flag(file.is_rename),
        is_copy: flag(file.is_copy),
        is_create: flag(file.is_create),
        is_delete: flag(file.is_delete),
        is_binary: flag(file.is_binary),
        hunks: file.hunks.into_iter().map(&hunk).collect(),
    }))
}

fn apply<'a, T: JsUnit>(
    heap: &JsHeap<'a>,
    source: &String,
    hunks: &[patch::HunkToApply<'_, T>],
) -> bindgen::Result<'a, String> {
    match patch::apply(&T::of(source), hunks) {
        Ok(patched) => Ok(clone_units(&patched)),
        Err(patch::ApplyError::Mismatch { hunk, reason }) => Err(heap.error_with_code(
            ErrorCode::PATCH_DOES_NOT_APPLY,
            format_args!("Hunk {} does not apply: {reason}", hunk + 1),
        )),
        Err(patch::ApplyError::InvalidOperation { hunk, line }) => Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!(
                "The property 'patch[{hunk}].lines[{line}]' must start with \" \", \"-\", \"+\" or \"\\\""
            ),
        )),
    }
}

fn binary_patch<'a>(heap: &JsHeap<'a>) -> bindgen::Error<'a> {
    heap.error_with_code(
        ErrorCode::INVALID_ARG_VALUE,
        format_args!("The argument 'patch' must change a text file. Received a binary patch"),
    )
}

fn apply_text<'a, T: JsUnit>(
    heap: &JsHeap<'a>,
    source: &String,
    text: &String,
) -> bindgen::Result<'a, String> {
    let mut text = T::of(text);
    let files = parse(heap, &mut text)?;
    if files.len() > 1 {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!(
                "The argument 'patch' must change one file. Received a patch for {} files",
                files.len()
            ),
        ));
    }
    let file = files.first();
    if file.is_some_and(|file| file.is_binary) {
        return Err(binary_patch(heap));
    }
    let hunks = file.map_or(&[][..], |file| &file.hunks);
    if hunks.is_empty() && !patch::can_lack_hunks(&text, file) {
        return Err(heap.syntax_error(format_args!(
            "The patch has no line that starts with \"@@ -start,lines +start,lines @@\""
        )));
    }
    let hunks = hunks.iter().map(|hunk| patch::HunkToApply {
        old_start: hunk.old_start as u32,
        lines: hunk.lines.iter().map(|line| &text[line.clone()]).collect(),
    });
    apply(heap, source, &hunks.collect::<Vec<_>>())
}

fn apply_hunks<'a, T: JsUnit>(
    heap: &JsHeap<'a>,
    source: &String,
    hunks: &[HunkToApply],
) -> bindgen::Result<'a, String> {
    let lines = hunks.iter().map(|hunk| hunk.lines.iter().map(T::of));
    let lines: Vec<Vec<Cow<'_, [T]>>> = lines.map(Iterator::collect).collect();
    let hunks = hunks.iter().zip(&lines);
    let hunks = hunks.map(|(hunk, lines)| patch::HunkToApply {
        old_start: hunk.old_start,
        lines: lines.iter().map(|line| &**line).collect(),
    });
    apply(heap, source, &hunks.collect::<Vec<_>>())
}

pub(crate) fn apply_patch<'a>(
    heap: &JsHeap<'a>,
    source: &String,
    patch: PatchToApply,
    options: &ApplyOptions,
) -> bindgen::Result<'a, String> {
    refuse!(
        heap,
        "fuzzFactor": options.fuzz_factor,
        "compareLine": options.compare_line,
        "autoConvertLineEndings": !options.auto_convert_line_endings
    );
    match patch {
        PatchToApply::Text(text) => by_width!([source, &text], apply_text(heap, source, &text)),
        PatchToApply::File(file) if file.is_binary => Err(binary_patch(heap)),
        PatchToApply::Hunks(hunks) | PatchToApply::File(FileToApply { hunks, .. }) => {
            let lines = || hunks.iter().flat_map(|hunk| &hunk.lines);
            // One string can be in there many times.
            if lines().map(String::length).sum::<usize>() > String::max_length() {
                return Err(heap.string_too_long());
            }
            let strings = lines().chain([source]);
            by_width!(strings, apply_hunks(heap, source, &hunks))
        }
    }
}
