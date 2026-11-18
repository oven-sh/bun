//! Custom sections with a meaning. One that is malformed does not make the module invalid.

use crate::alloc::TryPush;
use crate::index::FuncIndex;
use crate::module::{Module, Span};
use crate::reader::Reader;

fn payloads<'a>(module: &'a Module, name: &'a [u8]) -> impl Iterator<Item = Span> + 'a {
    let sections = module.custom_sections().iter();
    sections
        .filter(move |section| module.bytes(section.name) == name)
        .map(|section| section.payload)
}

/// The last that is well-formed (ECMA-426, 11.1.2.3).
pub(crate) fn source_map_url(module: &Module) -> Option<&str> {
    let urls = payloads(module, b"sourceMappingURL").filter_map(|payload| {
        let mut reader = Reader::new(module.bytes(payload), 0);
        let len = reader.u32()?;
        core::str::from_utf8(reader.slice(len as usize)?).ok()
    });
    urls.last()
}

/// Names are valid UTF-8.
pub struct Names {
    module: Option<Span>,
    /// Sorted. Of several names for a function the last counts.
    funcs: Vec<(FuncIndex, Span)>,
}

impl Names {
    const MODULE: u8 = 0;
    const FUNCS: u8 = 1;
    const LOCALS: u8 = 2;

    pub fn module(&self) -> Option<Span> {
        self.module
    }

    pub fn func(&self, func: FuncIndex) -> Option<Span> {
        let (named, name) =
            *self.funcs[..self.funcs.partition_point(|entry| entry.0 <= func)].last()?;
        (named == func).then_some(name)
    }

    pub(crate) fn parse(module: &Module) -> Option<Self> {
        payloads(module, b"name").find_map(|payload| Self::parse_section(module, payload))
    }

    fn parse_section(module: &Module, payload: Span) -> Option<Self> {
        let name = |reader: &mut Reader<'_>| {
            let len = reader.u32()?;
            let start = payload.start + reader.position() as u32;
            core::str::from_utf8(reader.slice(len as usize)?).ok()?;
            Some(Span { start, len })
        };
        let mut names = Self {
            module: None,
            funcs: Vec::new(),
        };
        let mut reader = Reader::new(module.bytes(payload), 0);
        let mut least_kind = 0;
        while reader.remaining() != 0 {
            let kind = reader.u7().filter(|&kind| kind >= least_kind)?;
            least_kind = kind + 1;
            let size = reader.u32()? as usize;
            let end = reader.position().checked_add(size)?;
            match kind {
                Self::MODULE => names.module = Some(name(&mut reader)?),
                Self::FUNCS => {
                    for _ in 0..reader.u32()? {
                        let func = reader
                            .u32()
                            .filter(|&func| (func as usize) < module.funcs().len())?;
                        names
                            .funcs
                            .try_push((FuncIndex(func), name(&mut reader)?))
                            .ok()?;
                    }
                }
                Self::LOCALS => {
                    for _ in 0..reader.u32()? {
                        reader.u32()?;
                        for _ in 0..reader.u32()? {
                            reader.u32()?;
                            name(&mut reader)?;
                        }
                    }
                }
                _ => {
                    reader.slice(size)?;
                }
            }
            if reader.position() != end {
                return None;
            }
        }
        names
            .funcs
            .sort_unstable_by_key(|&(func, name)| (func, name.start));
        Some(names)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BranchHint {
    pub func: FuncIndex,
    /// Of an `if` or `br_if`, as [`crate::Visit::at`] has it.
    pub offset: u32,
    /// Whether the condition is likely to hold.
    pub likely: bool,
}

pub struct BranchHints {
    /// Sorted by function and offset.
    hints: Vec<BranchHint>,
}

impl BranchHints {
    /// Sorted by offset.
    pub fn of(&self, func: FuncIndex) -> &[BranchHint] {
        let start = self.hints.partition_point(|hint| hint.func < func);
        let count = self.hints[start..].partition_point(|hint| hint.func == func);
        &self.hints[start..][..count]
    }

    /// Takes the first section, up to the function where it is malformed.
    pub(crate) fn parse(module: &Module) -> Self {
        let mut hints = Vec::new();
        if let Some(payload) = payloads(module, b"metadata.code.branch_hint").next() {
            let mut reader = Reader::new(module.bytes(payload), 0);
            let mut complete = 0;
            let mut least_func = 0;
            for _ in 0..reader.u32().unwrap_or(0) {
                match Self::parse_function(&mut reader, least_func, &mut hints) {
                    Some(func) => least_func = u64::from(func) + 1,
                    None => break,
                }
                complete = hints.len();
            }
            hints.truncate(complete);
        }
        Self { hints }
    }

    fn parse_function(
        reader: &mut Reader<'_>,
        least_func: u64,
        hints: &mut Vec<BranchHint>,
    ) -> Option<u32> {
        let func = reader.u32().filter(|&func| u64::from(func) >= least_func)?;
        let mut least_offset = 0;
        for _ in 0..reader.u32()? {
            let offset = reader
                .u32()
                .filter(|&offset| u64::from(offset) >= least_offset)?;
            least_offset = u64::from(offset) + 1;
            reader.u32().filter(|&size| size == 1)?;
            let value = reader.u8().filter(|&value| value <= 1)?;
            let hint = BranchHint {
                func: FuncIndex(func),
                offset,
                likely: value == 1,
            };
            hints.try_push(hint).ok()?;
        }
        Some(func)
    }
}
