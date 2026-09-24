//! Payload order file for `bun build --compile --bytecode` (`--bytecode-order`): what a previous run of the
//! application read out of its bytecode payload, written by that run under `BUN_BYTECODE_ORDER_OUT`. Text, one item
//! per line after a `v2` line: `F`/`S`/`M`/`N`/`K <16 hex digits>` = a function decoded to be run, a string read, a
//! module evaluated, a module that was in the executable and not evaluated, a function that was written in the
//! executable's code and not run (whether or not the executable had bytecode for it); `F` and `S` lines are in
//! first-use order. Code is named here, not by JavaScriptCore (`CodeNames`): the build that lays a payload out and
//! the run that records an order file parse the same text the same way. A string is JSC's
//! `bytecodeOrderStringHash`. The file only ever changes where things are placed: lines that are malformed, of an
//! unknown kind, or name nothing in this build are ignored.

use bun_js_parser::function_identities::{
    FunctionIdentities, FunctionIdentity, FunctionKind, Text,
};

/// What an order file calls the code of one text JavaScriptCore compiles, by where each function starts.
pub type CodeNames = FunctionIdentities;

/// A text an executable has bytecode for.
#[derive(Clone, Copy)]
pub enum Named<'a> {
    /// As it is embedded in the executable. `chunk_paths`: every chunk's path as the texts import it, sorted.
    Chunk {
        text: &'a [u8],
        is_esm: bool,
        chunk_paths: &'a [&'a [u8]],
    },
    /// Its source as the builtins section has it.
    InternalModule(&'a [u8]),
}

impl Named<'_> {
    /// `None`: it does not parse, and its code has no names.
    pub fn names(self) -> Option<CodeNames> {
        match self {
            Named::Chunk {
                text,
                is_esm,
                chunk_paths,
            } => FunctionIdentities::of_text(
                text,
                if is_esm { Text::Module } else { Text::Script },
                chunk_paths,
            ),
            Named::InternalModule(source) => {
                FunctionIdentities::of_text(source, Text::Builtin, &[])
            }
        }
    }
}

/// More than any thread that parsed what the text was printed from had: a text either side could not parse, and the
/// other could, would have names on one side only.
const NAMING_THREAD_STACK_SIZE: usize = 64 * 1024 * 1024;
const _: () = assert!(
    NAMING_THREAD_STACK_SIZE >= 3 * bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize
);

/// An order file's first line. Its names are the walker's (`FunctionIdentities`) of the Bun that built the executable
/// that recorded it: a change to what a name is a hash of changes this, and older files are told to be recorded again.
pub const VERSION: &str = "v2";

/// `BUN_BYTECODE_ORDER_NAMES_OUT`, where `bun:internal-for-testing` is: a debug build, or the tests' environment.
pub fn names_out() -> Option<&'static [u8]> {
    let is_for_tests = bun_core::env::IS_DEBUG
        || (bun_core::getenv_z(bun_core::zstr!("BUN_GARBAGE_COLLECTOR_LEVEL")).is_some()
            && bun_core::getenv_z(bun_core::zstr!("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING"))
                .is_some());
    is_for_tests
        .then(|| bun_core::env_var::BUN_BYTECODE_ORDER_NAMES_OUT.get_not_empty())
        .flatten()
}

/// `BUN_BYTECODE_ORDER_NAMES_OUT`: what the code `key` is the path of is called.
pub fn write_names_of(out: &mut Vec<u8>, key: &[u8], names: Option<&CodeNames>) {
    use std::io::Write;
    let _ = writeln!(out, "# {}", bstr::BStr::new(key));
    if let Some(names) = names {
        write_names(out, names);
    }
}

pub fn write_names(out: &mut Vec<u8>, names: &CodeNames) {
    use std::io::Write;
    if let Some(module) = names.module {
        let _ = writeln!(out, "M {module:016x}");
    }
    for function in &names.functions {
        let _ = writeln!(
            out,
            "{} {} {:016x}",
            function.start, function.kind as u8, function.identity
        );
    }
}

/// In a build and at the exit of the run that records alike: on threads of their own (the process's pool may never
/// get to it at exit), or on this one if there are none to be had.
pub fn names_of_all(texts: &[Named<'_>]) -> Vec<Option<CodeNames>> {
    let names: Vec<std::sync::OnceLock<Option<CodeNames>>> =
        texts.iter().map(|_| std::sync::OnceLock::new()).collect();
    let next = core::sync::atomic::AtomicUsize::new(0);
    let name_the_rest = || {
        loop {
            let index = next.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
            let Some(text) = texts.get(index) else { break };
            let _ = names[index].set(text.names());
        }
    };
    std::thread::scope(|scope| {
        let threads = usize::from(bun_core::get_thread_count()).min(8);
        for _ in 0..threads.min(texts.len()) {
            let spawned = std::thread::Builder::new()
                .stack_size(NAMING_THREAD_STACK_SIZE)
                .spawn_scoped(scope, || {
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!(
                        "BytecodeOrder"
                    ));
                    name_the_rest();
                });
            if spawned.is_err() {
                break;
            }
        }
    });
    if !texts.is_empty() && names.iter().all(|names| names.get().is_none()) {
        bun_core::warn!(
            "no thread could be started to name the code of a bytecode order file: it is named on this one, which may have less stack"
        );
    }
    name_the_rest();
    names
        .into_iter()
        .map(|names| names.into_inner().flatten())
        .collect()
}

/// What a link ends with.
pub struct LinkedPayload {
    pub payload: Vec<u8>,
    /// Each module's cache entry.
    pub entry_offsets: Vec<u32>,
    pub region_ends: [u32; REGION_COUNT],
    /// How many of the order files' hot functions name a function of the link, and how many functions went to HOT.
    pub named_hot_functions: u32,
    pub placed_hot_functions: u32,
    /// How many functions of modules that have names have none.
    pub functions_without_name: u32,
}

/// `Bun::BytecodeOrderNamesRef`. A text that did not parse has no names: its functions are laid out as code no order
/// file knows, and counted (`JSC::BytecodeLinkEncoder::Result::functionsWithoutName`).
#[repr(C)]
pub struct CodeNamesRef<'a> {
    module: u64,
    functions: *const FunctionIdentity,
    function_count: usize,
    names: core::marker::PhantomData<&'a CodeNames>,
}

impl<'a> From<Option<&'a CodeNames>> for CodeNamesRef<'a> {
    fn from(names: Option<&'a CodeNames>) -> Self {
        let functions: &[FunctionIdentity] = names.map_or(&[], |names| &names.functions);
        Self {
            // Not a name (`JSC::isValidOrderHash`).
            module: names.and_then(|names| names.module).unwrap_or(u64::MAX),
            functions: functions.as_ptr(),
            function_count: functions.len(),
            names: core::marker::PhantomData,
        }
    }
}

/// `JSC::RecordedOrderSource`: the bytecode a recorder saw something decoded from is known by where it is.
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct RecordedSource {
    pub payload: *const u8,
    pub entry_offset: u32,
}

/// `JSC::RecordedOrderFunction`.
#[repr(C)]
pub struct RecordedFunction {
    /// An index into the recording's sources.
    pub source: u32,
    pub start: u32,
    /// `FunctionKind`, as JavaScriptCore wrote it.
    pub kind: u8,
}

/// What the VMs of a process recorded (`JSC::BytecodeOrderRecording`). Anything may be listed more than once.
pub struct Recording<'a> {
    /// For each source, the names of the module it is the bytecode of. `None`: not one of the executable's modules
    /// (the runtime's own builtins have bytecode too), or one whose text does not parse.
    pub sources: &'a [Option<&'a CodeNames>],
    pub functions: &'a [RecordedFunction],
    /// Indices into `sources`.
    pub evaluated_sources: &'a [u32],
    pub strings: &'a [u64],
}

/// The order file of `recording`, and how many functions the program ran that have no name. `modules`: everything the
/// executable has bytecode for.
pub fn write(modules: &[Option<&CodeNames>], recording: &Recording<'_>) -> (Vec<u8>, usize) {
    use std::io::Write;
    let mut text = format!("{VERSION}\n").into_bytes();
    let mut seen = bun_collections::HashMap::<(u8, u64), ()>::default();
    let mut line = |seen_as: u8, kind: u8, hash: u64| {
        if seen.insert((seen_as, hash), ()).is_none() {
            let _ = writeln!(text, "{} {hash:016x}", kind as char);
        }
    };
    let names_of = |source: u32| recording.sources.get(source as usize).copied().flatten();
    let mut functions_without_name = 0usize;
    for function in recording.functions {
        let Some(names) = names_of(function.source) else {
            continue;
        };
        match FunctionKind::from_u8(function.kind).and_then(|kind| names.find(function.start, kind))
        {
            Some(name) => line(b'F', b'F', name),
            None => functions_without_name += 1,
        }
    }
    for &source in recording.evaluated_sources {
        if let Some(name) = names_of(source).and_then(|names| names.module) {
            line(b'M', b'M', name);
        }
    }
    for &string in recording.strings {
        line(b'S', b'S', string);
    }
    for names in modules.iter().flatten() {
        if let Some(name) = names.module {
            line(b'M', b'N', name);
        }
        for function in &names.functions {
            line(b'F', b'K', function.identity);
        }
    }
    if functions_without_name != 0 {
        let _ = writeln!(
            text,
            "# {functions_without_name} functions the program ran have no name"
        );
    }
    (text, functions_without_name)
}

/// Why a file has nothing for the build.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unusable {
    /// It does not start with a version line.
    NotAnOrderFile,
    /// Another version's names are names of something else.
    OtherVersion,
    /// It lists nothing.
    Empty,
    /// The run that wrote it could not name the program's code (`NOT_RECORDED`).
    NotRecorded,
    Utf16,
}

/// What a run that has nothing to list writes after the version line, over whatever the path held before.
pub const NOT_RECORDED: &str = "# not recorded";

impl Unusable {
    pub(crate) fn why(self) -> &'static str {
        match self {
            Self::NotAnOrderFile => "is not a bytecode order file",
            Self::OtherVersion => "was recorded by another version of Bun: record it again",
            Self::Empty => "lists nothing",
            Self::NotRecorded => {
                "was written by a run that recorded nothing: see what that run printed"
            }
            Self::Utf16 => "is UTF-16: write it as UTF-8",
        }
    }
}

#[derive(Default)]
pub(crate) struct BytecodeOrder {
    pub hot_functions: Vec<u64>,
    /// With `hot_functions`, every function the recorded build had: one of this build in neither is new or changed.
    pub known_functions: Vec<u64>,
    pub hot_strings: Vec<u64>,
    pub evaluated_modules: Vec<u64>,
    pub not_evaluated_modules: Vec<u64>,
}

const MAX_FILE_SIZE: usize = 64 * 1024 * 1024;

impl BytecodeOrder {
    /// `paths`: one or more order files, most important first (one per entry point of the application, say); they
    /// are merged (`merge`). Each is read once, front to back, so a pipe will do. `Ok`: the order, `None` if no file has
    /// any hints (so the link is laid out as without one), and the files that have none (empty, another format, nothing
    /// but unknown lines). `Err`: the file that cannot be read.
    pub(crate) fn load<'a>(
        paths: impl Iterator<Item = &'a [u8]>,
    ) -> Result<(Option<Self>, Vec<(&'a [u8], Unusable)>), (&'a [u8], bun_sys::Error)> {
        let too_big = || bun_sys::Error::from_code(bun_sys::E::EFBIG, bun_sys::Tag::read);
        let mut profiles: Vec<Self> = Vec::new();
        let mut without_hints: Vec<(&'a [u8], Unusable)> = Vec::new();
        for path in paths {
            let read = || -> Result<Result<Self, Unusable>, bun_sys::Error> {
                let file = bun_sys::File::openat(bun_core::Fd::cwd(), path, bun_sys::O::RDONLY, 0)?;
                if file.get_end_pos()? > MAX_FILE_SIZE {
                    return Err(too_big());
                }
                // A pipe has no size to check up front.
                let mut text = Vec::new();
                let mut chunk = [0u8; 64 * 1024];
                loop {
                    let read = file.read(&mut chunk)?;
                    if read == 0 {
                        break;
                    }
                    if text.len() + read > MAX_FILE_SIZE {
                        return Err(too_big());
                    }
                    text.extend_from_slice(&chunk[..read]);
                }
                Ok(Self::parse(&text))
            };
            match read().map_err(|err| (path, err))? {
                Ok(profile) => profiles.push(profile),
                Err(why) => without_hints.push((path, why)),
            }
        }
        let order = Self::merge(&profiles);
        Ok(((!order.is_empty()).then_some(order), without_hints))
    }

    /// Deterministic in the files and their order: the first file's functions as it lists them, then the ones the
    /// second adds, in its order, and so on (strings likewise). Measured on a large program with an interactive and a
    /// one-shot way of starting, this costs the first way next to nothing, where grouping what the files share in
    /// front made its startup read the functions it only needs later. A module is evaluated if any file says so.
    pub(crate) fn merge(profiles: &[Self]) -> Self {
        fn merge_ranked(lists: Vec<&[u64]>) -> Vec<u64> {
            let mut seen = bun_collections::HashMap::<u64, ()>::default();
            lists
                .into_iter()
                .flatten()
                .copied()
                .filter(|&hash| seen.insert(hash, ()).is_none())
                .collect()
        }
        Self {
            hot_functions: merge_ranked(profiles.iter().map(|p| &p.hot_functions[..]).collect()),
            known_functions: merge_ranked(
                profiles.iter().map(|p| &p.known_functions[..]).collect(),
            ),
            hot_strings: merge_ranked(profiles.iter().map(|p| &p.hot_strings[..]).collect()),
            evaluated_modules: merge_ranked(
                profiles.iter().map(|p| &p.evaluated_modules[..]).collect(),
            ),
            // The encoder drops the ones some profile evaluated.
            not_evaluated_modules: merge_ranked(
                profiles
                    .iter()
                    .map(|p| &p.not_evaluated_modules[..])
                    .collect(),
            ),
        }
    }

    fn is_empty(&self) -> bool {
        self.hot_functions.is_empty()
            && self.known_functions.is_empty()
            && self.hot_strings.is_empty()
            && self.evaluated_modules.is_empty()
            && self.not_evaluated_modules.is_empty()
    }

    pub(crate) fn parse(text: &[u8]) -> Result<Self, Unusable> {
        let mut order = Self::default();
        if text.starts_with(&[0xff, 0xfe]) || text.starts_with(&[0xfe, 0xff]) {
            return Err(Unusable::Utf16);
        }
        let text = text.strip_prefix(b"\xef\xbb\xbf").unwrap_or(text);
        let mut lines = bun_core::strings::split(text, b"\n")
            .map(<[u8]>::trim_ascii)
            .skip_while(|line| line.is_empty() || line.starts_with(b"#"));
        match lines.next() {
            Some(version) if version == VERSION.as_bytes() => {}
            Some([b'v', version @ ..])
                if !version.is_empty() && version.iter().all(u8::is_ascii_digit) =>
            {
                return Err(Unusable::OtherVersion);
            }
            _ => return Err(Unusable::NotAnOrderFile),
        }
        for line in lines {
            let line = line.trim_ascii();
            let [kind, b' ', digits @ ..] = line else {
                continue;
            };
            if digits.len() != 16 {
                continue;
            }
            // An order file's hashes never have the top two values: they are JSC's hash-table sentinels.
            let Some(hash) = core::str::from_utf8(digits)
                .ok()
                .filter(|digits| digits.bytes().all(|digit| digit.is_ascii_hexdigit()))
                .and_then(|digits| u64::from_str_radix(digits, 16).ok())
                .filter(|&hash| hash < u64::MAX - 1)
            else {
                continue;
            };
            match kind {
                b'F' => order.hot_functions.push(hash),
                b'K' => order.known_functions.push(hash),
                b'S' => order.hot_strings.push(hash),
                b'M' => order.evaluated_modules.push(hash),
                b'N' => order.not_evaluated_modules.push(hash),
                _ => {}
            }
        }
        if order.is_empty() {
            let is_not_recorded = bun_core::strings::split(text, b"\n")
                .any(|line| line.starts_with(NOT_RECORDED.as_bytes()));
            return Err(if is_not_recorded {
                Unusable::NotRecorded
            } else {
                Unusable::Empty
            });
        }
        Ok(order)
    }
}

/// How many regions a linked payload has.
pub const REGION_COUNT: usize = bun_resolver::LINKED_BYTECODE_REGION_COUNT;

/// A `BytecodePayload` output file is the payload followed by where each of its regions ends.
pub(crate) fn payload_file(payload: Vec<u8>, region_ends: [u32; REGION_COUNT]) -> Box<[u8]> {
    let mut file = payload;
    for end in region_ends {
        file.extend_from_slice(&end.to_le_bytes());
    }
    file.into_boxed_slice()
}

/// The payload and its region ends out of a `BytecodePayload` output file.
pub fn split_payload_file(file: &[u8]) -> (&[u8], [u32; REGION_COUNT]) {
    let (payload, tail) = file.split_at(file.len() - REGION_COUNT * size_of::<u32>());
    let mut region_ends = [0u32; REGION_COUNT];
    for (end, bytes) in region_ends.iter_mut().zip(tail.as_chunks::<4>().0) {
        *end = u32::from_le_bytes(*bytes);
    }
    (payload, region_ends)
}
