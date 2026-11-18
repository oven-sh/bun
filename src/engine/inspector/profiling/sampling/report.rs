//! The samples for people and for tools.

use core::cmp::Reverse;
use core::fmt::Write;
use std::collections::BTreeMap;

use bun_engine_bytecode::Specialization;
use bun_engine_text::{AllocError, StringBuilder, StringRef};
use bun_engine_vm::{
    EvalExecutable, FastHashMap, FunctionExecutable, LineColumn, ProgramExecutable, SourceProvider,
    Tier, Vm, WasmTier, options,
};

use super::profile::{CallTree, Location, SampledFrame, SampledFrameKind};
use crate::profiling::json::JsonWriter;

const NO_POSITION: LineColumn = LineColumn {
    line: u32::MAX,
    column: u32::MAX,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Category {
    Interpreter,
    Baseline,
    QuickOptimized,
    FullyOptimized,
    /// Counts some of those above a second time.
    Builtin,
    WasmInterpreter,
    WasmBaseline,
    WasmOptimized,
    Wasm,
    Host,
    RegExp,
    NativeCode,
    UnknownFrame,
    UnknownExecutable,
}

/// In the order of `Category`.
const CATEGORY_NAMES: [&str; 14] = [
    "LLInt",
    "Baseline",
    "DFG",
    "FTL",
    "js builtin",
    "IPInt",
    "BBQ",
    "OMG",
    "Wasm",
    "Host",
    "RegExp",
    "C/C++",
    "Unknown Frame",
    "Unknown Executable",
];

impl Category {
    fn of(frame: SampledFrame<'_>) -> Category {
        match (frame.kind(), frame.location()) {
            (_, Location::Script { tier, .. }) => match tier {
                Tier::Interpreter => Category::Interpreter,
                Tier::Baseline => Category::Baseline,
                Tier::QuickOptimized => Category::QuickOptimized,
                Tier::FullyOptimized => Category::FullyOptimized,
            },
            (_, Location::Wasm(tier)) => match tier {
                WasmTier::Interpreter => Category::WasmInterpreter,
                WasmTier::Baseline => Category::WasmBaseline,
                WasmTier::Optimized | WasmTier::OptimizedForLoopEntry => Category::WasmOptimized,
                WasmTier::StubFromScript | WasmTier::StubToScript => Category::Wasm,
            },
            (SampledFrameKind::Executable, _) => Category::UnknownExecutable,
            (SampledFrameKind::Wasm, _) => Category::Wasm,
            (SampledFrameKind::Host, _) => Category::Host,
            (SampledFrameKind::RegExp, _) => Category::RegExp,
            (SampledFrameKind::NativeCode, _) => Category::NativeCode,
            (SampledFrameKind::Unknown, _) => Category::UnknownFrame,
        }
    }

    fn name(self) -> &'static str {
        CATEGORY_NAMES[self as usize]
    }
}

fn is_builtin(frame: SampledFrame<'_>) -> bool {
    let function = frame.executable().and_then(|it| it.downcast());
    function.is_some_and(|it: bun_engine_vm::Gc<FunctionExecutable>| it.is_builtin())
}

/// Only for those who have asked for more.
fn inliner(frame: SampledFrame<'_>) -> Option<SampledFrame<'_>> {
    (frame.inliner()).filter(|_| options().collect_extra_sampling_data)
}

fn name_as_inliner(frame: SampledFrame<'_>) -> StringRef {
    let Some(executable) = frame.executable() else {
        return StringRef::empty();
    };
    if let Some(function) = executable.downcast::<FunctionExecutable>() {
        function.name().clone()
    } else if executable.is::<ProgramExecutable>() {
        StringRef::from_literal("<global>")
    } else if executable.is::<EvalExecutable>() {
        StringRef::from_literal("<eval>")
    } else {
        let url = frame.source_provider().and_then(|it| it.url().cloned());
        (url.filter(|url| !url.is_empty())).unwrap_or_else(|| StringRef::from_literal("<module>"))
    }
}

/// Of the text of the code, by the address of the executable.
#[derive(Default)]
struct Hashes(FastHashMap<usize, u32>);

impl Hashes {
    /// Six characters that tell functions of the same name apart, from one run to the next too.
    fn write(&mut self, out: &mut StringBuilder, frame: SampledFrame<'_>) {
        const DIGITS: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let (Location::Script { specialization, .. }, Some(executable)) =
            (frame.location(), frame.executable())
        else {
            return out.push_ascii("<nil>");
        };
        let hash = *self.0.entry(executable.address()).or_insert_with(|| {
            frame.source().map_or(0, |(provider, range)| {
                let range = range.start as usize..range.end as usize;
                provider.text().slice(range).hash()
            })
        });
        let mut rest = hash ^ u32::from(specialization == Specialization::Construct);
        let mut digits = [0; 6];
        for digit in digits.iter_mut().rev() {
            *digit = DIGITS[rest as usize % DIGITS.len()];
            rest /= DIGITS.len() as u32;
        }
        out.push_latin1_slice(&digits);
    }

    fn write_location(&mut self, out: &mut StringBuilder, frame: SampledFrame<'_>) {
        let (tier, instruction) = match frame.location() {
            Location::Wasm(tier) => {
                let tier = match tier {
                    WasmTier::OptimizedForLoopEntry => "OMGForOSREntry",
                    WasmTier::StubFromScript => "JSToWasm",
                    WasmTier::StubToScript => "WasmToJS",
                    _ => Category::of(frame).name(),
                };
                let _ = write!(out, ":{tier}:nil");
                return;
            }
            Location::Script { instruction, .. } => (Category::of(frame).name(), instruction),
            Location::None if frame.kind() == SampledFrameKind::RegExp => ("RegExp", None),
            Location::None => ("None", None),
        };
        out.push_latin1(b'#');
        self.write(out, frame);
        let _ = match instruction {
            Some((offset, _)) => write!(out, ":{tier}:bc#{offset}"),
            None => write!(out, ":{tier}:<nil>"),
        };
    }

    fn location(&mut self, frame: SampledFrame<'_>) -> StringRef {
        let mut location = StringBuilder::new();
        self.write_location(&mut location, frame);
        location.finish().unwrap_or_default()
    }
}

/// With how many samples each is the innermost frame of.
fn innermost_frames(tree: &CallTree) -> Vec<(SampledFrame<'_>, usize)> {
    let mut counts = FastHashMap::default();
    for trace in tree.traces() {
        let frame = trace.innermost;
        counts.entry(frame.index()).or_insert((frame, 0)).1 += 1;
    }
    counts.into_values().collect()
}

fn write_most_frequent(
    out: &mut StringBuilder,
    frames: &[(SampledFrame<'_>, usize)],
    limit: u32,
    mut describe: impl FnMut(&mut StringBuilder, SampledFrame<'_>),
) {
    let mut counts = FastHashMap::<StringRef, usize>::default();
    for &(frame, count) in frames {
        let mut description = StringBuilder::new();
        describe(&mut description, frame);
        *(counts.entry(description.finish().unwrap_or_default())).or_default() += count;
    }
    let mut counts: Vec<_> = counts.into_iter().collect();
    counts.sort_unstable_by(|a, b| (Reverse(a.1), a.0.text()).cmp(&(Reverse(b.1), b.0.text())));
    for (description, count) in counts.iter().take(limit as usize) {
        let _ = write!(out, "{count:6}    '");
        out.push_text(description.text());
        out.push_ascii("'\n");
    }
}

fn write_heading(out: &mut StringBuilder, tree: &CallTree, interval_seconds: f64) {
    let (interval, total) = (interval_seconds * 1e6, tree.traces().len());
    let _ = writeln!(
        out,
        "\n\nSampling rate: {interval:.6} microseconds. Total samples: {total}"
    );
}

pub(super) fn top_functions(tree: &CallTree, interval_seconds: f64) -> StringRef {
    let (mut out, limit) = (StringBuilder::new(), options().top_functions_count);
    if limit != 0 {
        write_heading(&mut out, tree, interval_seconds);
        out.push_ascii("Top functions as <numSamples  'functionName#hash:sourceID'>\n");
        let mut hashes = Hashes::default();
        write_most_frequent(&mut out, &innermost_frames(tree), limit, |out, frame| {
            out.push_text(frame.name().text());
            out.push_latin1(b'#');
            hashes.write(out, frame);
            let _ = write!(out, ":{}", frame.source_id());
        });
    }
    out.finish().unwrap_or_default()
}

fn write_categories(out: &mut StringBuilder, frames: &[(SampledFrame<'_>, usize)], total: usize) {
    const WIDTH: usize = "Unknown Executable".len() + 4;
    let mut counts = [0; CATEGORY_NAMES.len()];
    for &(frame, count) in frames {
        counts[Category::of(frame) as usize] += count;
        if is_builtin(frame) {
            counts[Category::Builtin as usize] += count;
        }
    }
    out.push_ascii("\nTier breakdown:\n-----------------------------------\n");
    for (index, (name, count)) in CATEGORY_NAMES.into_iter().zip(counts).enumerate() {
        if count != 0 || index < Category::UnknownFrame as usize {
            let (padding, share) = (WIDTH - name.len() - 1, count as f64 / total.max(1) as f64);
            let _ = writeln!(
                out,
                "{name}:{:padding$}{count:6}  ({:.6}%)",
                "",
                share * 100.0
            );
        }
    }
}

pub(super) fn top_bytecodes(tree: &CallTree, interval_seconds: f64) -> StringRef {
    let (mut out, limit) = (StringBuilder::new(), options().top_bytecodes_count);
    if limit != 0 {
        let frames = innermost_frames(tree);
        write_heading(&mut out, tree, interval_seconds);
        write_categories(&mut out, &frames, tree.traces().len());
        out.push_ascii(
            "\n\nHottest bytecodes as <numSamples   'functionName#hash:JITType:bytecodeIndex'>\n",
        );
        let mut hashes = Hashes::default();
        write_most_frequent(&mut out, &frames, limit, |out, frame| {
            out.push_text(frame.name().text());
            hashes.write_location(out, frame);
            if let Some(inliner) = inliner(frame) {
                out.push_ascii(" <-- ");
                out.push_text(name_as_inliner(inliner).text());
                hashes.write_location(out, inliner);
            }
        });
    }
    out.finish().unwrap_or_default()
}

/// In the text that was written, and its URL if that is another.
fn mapped_position(vm: &Vm, frame: SampledFrame<'_>) -> (LineColumn, Option<StringRef>) {
    let (mut position, mut url) = (frame.position().unwrap_or(NO_POSITION), None);
    if let (Some(map), Some(provider)) = (
        vm.embedder().errors.map_position.get(),
        frame.source_provider(),
    ) {
        map(vm, &provider, &mut position, &mut url);
    }
    (position, url.filter(|url| !url.is_empty()))
}

fn write_member(out: &mut StringBuilder, name: &str, value: Option<&StringRef>) {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        let _ = write!(out, r#","{name}":"#);
        out.string(value.text());
    }
}

fn frame_as_json(vm: &Vm, hashes: &mut Hashes, frame: SampledFrame<'_>) -> StringRef {
    let mut out = StringBuilder::new();
    let category = Category::of(frame).name();
    let _ = write!(out, r#"{{"sourceID":{},"name":"#, frame.source_id());
    out.string(frame.name().text());
    write_member(&mut out, "location", Some(&hashes.location(frame)));
    let (LineColumn { line, column }, url) = mapped_position(vm, frame);
    write_member(&mut out, "sourceURL", url.as_ref());
    let flags = u8::from(is_builtin(frame));
    let _ = write!(
        out,
        r#","line":{line},"column":{column},"category":"{category}","flags":{flags}"#
    );
    if let Some(inliner) = inliner(frame) {
        out.raw(br#","inliner":{"name":"#);
        out.string(name_as_inliner(inliner).text());
        write_member(&mut out, "location", Some(&hashes.location(inliner)));
        let (LineColumn { line, column }, _) = mapped_position(vm, inliner);
        let _ = write!(
            out,
            r#","line":{line},"column":{column},"category":"{category}"}}"#
        );
    }
    out.raw(b"}");
    out.finish().unwrap_or_default()
}

fn write_source(out: &mut StringBuilder, provider: &SourceProvider) {
    let _ = write!(out, r#"{{"sourceID":{}"#, provider.id());
    write_member(out, "url", provider.url());
    write_member(out, "sourceURL", provider.source_url_directive().as_ref());
    let source_map = provider.source_mapping_url_directive();
    write_member(out, "sourceMappingURL", source_map.as_ref());
    out.raw(b"}");
}

pub(super) fn traces_as_json(
    vm: &Vm,
    tree: &CallTree,
    interval_seconds: f64,
) -> Result<StringRef, AllocError> {
    let (mut out, mut hashes) = (StringBuilder::new(), Hashes::default());
    let (mut written, mut sources) = (FastHashMap::default(), BTreeMap::new());
    out.raw(br#"{"interval":"#);
    out.number(interval_seconds);
    out.raw(br#","traces":["#);
    out.separated(tree.traces(), |out, trace| {
        out.raw(br#"{"timestamp":"#);
        out.number(trace.timestamp);
        out.raw(br#","frames":["#);
        out.separated(trace.frames(), |out, frame| {
            let json = written.entry(frame.index()).or_insert_with(|| {
                sources.extend(frame.source_provider().map(|it| (it.id(), it)));
                frame_as_json(vm, &mut hashes, frame)
            });
            out.push_text(json.text());
        });
        out.raw(b"]}");
    });
    out.raw(br#"],"sources":["#);
    out.separated(sources.values(), |out, it| write_source(out, it));
    out.raw(b"]}");
    out.finish()
}
