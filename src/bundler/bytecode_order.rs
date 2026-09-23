//! Payload order file for `bun build --compile --bytecode` (`--bytecode-order`): what a previous run of the
//! application read out of its bytecode payload, written by that run under `BUN_BYTECODE_ORDER_OUT`. Text, one item
//! per line after a `v1` line: `F`/`S`/`M`/`N`/`K <16 hex digits>` = a function decoded, a string read, a module
//! evaluated, a module that was in the executable and not evaluated, a function that was in the executable and not
//! decoded; `F` and `S` lines are in first-use order. The hashes are JSC's (`JSC::BytecodeOrderFile`: code is named by
//! its own text plus the names of the functions nested in it) and `bytecodeOrderStringHash`. The file only ever changes where
//! things are placed: lines that are malformed, of an unknown kind, or name nothing in this build are ignored.

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
    ) -> Result<(Option<Self>, Vec<&'a [u8]>), (&'a [u8], bun_sys::Error)> {
        let too_big = || bun_sys::Error::from_code(bun_sys::E::EFBIG, bun_sys::Tag::read);
        let mut profiles: Vec<Self> = Vec::new();
        let mut without_hints: Vec<&'a [u8]> = Vec::new();
        for path in paths {
            let read = || -> Result<Self, bun_sys::Error> {
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
            let profile = read().map_err(|err| (path, err))?;
            if profile.is_empty() {
                without_hints.push(path);
            }
            profiles.push(profile);
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

    pub(crate) fn parse(text: &[u8]) -> Self {
        let mut order = Self::default();
        let mut lines = bun_core::strings::split(text, b"\n");
        if lines.next().map(<[u8]>::trim_ascii) != Some(b"v1") {
            return order;
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
        order
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
