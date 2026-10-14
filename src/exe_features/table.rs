//! The table, and the part of its encoding that both kinds share.
//!
//! ```text
//! "BUNFEAT\0"  version  kind  container  arch
//! features  n { id, length, name }
//! areas     n { low, high - low, towards (0 low, 1 high), length, fill }
//! code      n { low, high - low }
//! patches   n { place, feature, length, bytes }
//! ```
//! What follows depends on the kind: [`crate::expand`] for the one that ships, [`Table::read_written_out`] for the one
//! `scripts/build` hands to the host tool.

use crate::bytes::Reader;
use crate::{Error, Result};

pub(crate) const MAGIC: &[u8; 8] = b"BUNFEAT\0";
pub(crate) const VERSION: u8 = 1;
#[cfg(feature = "tool")]
pub(crate) const KIND_WRITTEN_OUT: u8 = 0;
pub(crate) const KIND_COMPACT: u8 = 1;

/// What the headers look like and what the loader reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Container {
    Elf = 1,
    MachO = 2,
    Pe = 3,
}

/// How code holds addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Arch {
    X64 = 1,
    Arm64 = 2,
}

impl Arch {
    /// What the segments of a Mach-O are aligned to.
    pub(crate) fn macho_page_size(self) -> u64 {
        match self {
            Self::X64 => 0x1000,
            Self::Arm64 => 0x4000,
        }
    }
}

/// The two are independent: nothing is written for a pair of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Format {
    pub(crate) container: Container,
    pub(crate) arch: Arch,
}

/// How a field holds an address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub(crate) enum Form {
    /// Only an edge: nothing to patch.
    None,
    /// 64- or 32-bit address: `+= target`
    Abs64,
    Abs32,
    /// 32- or 64-bit distance from the field to the target: `+= target - place`
    Rel32,
    Rel64,
    /// Like `Abs64`, but it does not keep its target alive, and reads 0 once the target is gone.
    Abs64Weak,
    /// 32-bit offset of the target from the image base.
    Base32,
    /// arm64 `b` / `bl`
    Branch26,
    /// arm64 `adrp`. `extra` holds the low 12 bits of the target, which the instruction does not.
    Page21,
    /// arm64 `add` / `ldr` / `str` with the low 12 bits of the target. `extra` is log2 of the scale.
    PageOff12,
    /// Mach-O: a pointer in a fixup chain that the loader rebases. The low 36 bits are the address.
    ChainRebase,
    /// Like `ChainRebase`, but it does not keep its target alive: a slot of the GOT.
    ChainRebaseWeak,
}

impl Form {
    pub(crate) fn from_u8(value: u8) -> Result<Self> {
        const ALL: [Form; 12] = [
            Form::None,
            Form::Abs64,
            Form::Abs32,
            Form::Rel32,
            Form::Rel64,
            Form::Abs64Weak,
            Form::Base32,
            Form::Branch26,
            Form::Page21,
            Form::PageOff12,
            Form::ChainRebase,
            Form::ChainRebaseWeak,
        ];
        ALL.get(usize::from(value))
            .copied()
            .ok_or(Error::InvalidTable)
    }

    pub(crate) fn is_weak(self) -> bool {
        matches!(self, Self::Abs64Weak | Self::ChainRebaseWeak)
    }
}

/// "No unit": what a fixup refers to stays and does not move.
pub(crate) const NO_UNIT: u32 = u32::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Fixup {
    pub(crate) place: u64,
    pub(crate) form: Form,
    pub(crate) target: u32,
    pub(crate) extra: u16,
}

pub(crate) const STARTS_PIECE: u8 = 1;
/// Always live.
pub(crate) const ROOT: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Unit {
    pub(crate) start: u64,
    pub(crate) size: u64,
    pub(crate) flags: u8,
    /// Of the piece this unit starts.
    pub(crate) log2_align: u8,
}

impl Unit {
    pub(crate) fn end(&self) -> u64 {
        self.start + self.size
    }
    pub(crate) fn starts_piece(&self) -> bool {
        self.flags & STARTS_PIECE != 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Flow {
    pub(crate) from: u32,
    pub(crate) to: u32,
    /// 0: always. `2 * id + 1`: if the feature is present. `2 * id + 2`: if it is excluded.
    pub(crate) condition: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Area {
    pub(crate) low: u64,
    pub(crate) high: u64,
    pub(crate) towards_high: bool,
    /// What takes the place of code or data that is gone: a trap, or zero.
    pub(crate) fill: Box<[u8]>,
}

impl Area {
    pub(crate) fn contains(&self, address: u64) -> bool {
        address >= self.low && address < self.high
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Feature {
    pub(crate) id: u32,
    pub(crate) name: Box<[u8]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Patch {
    pub(crate) place: u64,
    pub(crate) feature: u32,
    pub(crate) bytes: Box<[u8]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Table {
    pub(crate) format: Format,
    pub(crate) features: Vec<Feature>,
    pub(crate) areas: Vec<Area>,
    /// Where the instructions are.
    pub(crate) code: Vec<(u64, u64)>,
    pub(crate) patches: Vec<Patch>,
    /// Sorted by address.
    pub(crate) units: Vec<Unit>,
    /// Sorted by `from`.
    pub(crate) flows: Vec<Flow>,
    /// Sorted.
    pub(crate) fixups: Vec<Fixup>,
}

impl Table {
    /// The unit that holds `address`, or [`NO_UNIT`].
    pub(crate) fn unit_at(&self, address: u64) -> u32 {
        let after = self.units.partition_point(|u| u.start <= address);
        match after.checked_sub(1) {
            Some(u) if address - self.units[u].start < self.units[u].size => u as u32,
            _ => NO_UNIT,
        }
    }

    pub(crate) fn area_of(&self, address: u64) -> Option<usize> {
        self.areas.iter().position(|area| area.contains(address))
    }

    /// The fixups whose place is in `[start, end)`.
    pub(crate) fn fixups_in(&self, start: u64, end: u64) -> &[Fixup] {
        let from = self.fixups.partition_point(|f| f.place < start);
        let to = from + self.fixups[from..].partition_point(|f| f.place < end);
        &self.fixups[from..to]
    }

    pub(crate) fn flows_from(&self, unit: u32) -> &[Flow] {
        let from = self.flows.partition_point(|f| f.from < unit);
        let to = from + self.flows[from..].partition_point(|f| f.from == unit);
        &self.flows[from..to]
    }

    /// Everything up to the units, which come back empty, and what is left of `bytes`.
    pub(crate) fn read_header(bytes: &[u8], kind: u8) -> Result<(Self, Reader<'_>)> {
        let mut r = Reader::new(bytes);
        if r.take(MAGIC.len()).map_err(|_| Error::InvalidTable)? != MAGIC {
            return Err(Error::InvalidTable);
        }
        if r.byte()? != VERSION {
            return Err(Error::UnsupportedTableVersion);
        }
        if r.byte()? != kind {
            return Err(Error::InvalidTable);
        }
        let container = match r.byte()? {
            1 => Container::Elf,
            2 => Container::MachO,
            3 => Container::Pe,
            _ => return Err(Error::InvalidTable),
        };
        let arch = match r.byte()? {
            1 => Arch::X64,
            2 => Arch::Arm64,
            _ => return Err(Error::InvalidTable),
        };
        let format = Format { container, arch };
        let mut features = Vec::new();
        for _ in 0..r.count()? {
            features.push(Feature {
                id: r.u32()?,
                name: r.blob()?.into(),
            });
        }
        let mut areas = Vec::new();
        for _ in 0..r.count()? {
            let low = r.unsigned()?;
            let high = low.checked_add(r.unsigned()?).ok_or(Error::InvalidTable)?;
            let towards_high = r.unsigned()? != 0;
            let fill: Box<[u8]> = r.blob()?.into();
            if fill.is_empty() {
                return Err(Error::InvalidTable);
            }
            areas.push(Area {
                low,
                high,
                towards_high,
                fill,
            });
        }
        let mut code = Vec::new();
        for _ in 0..r.count()? {
            let low = r.unsigned()?;
            code.push((
                low,
                low.checked_add(r.unsigned()?).ok_or(Error::InvalidTable)?,
            ));
        }
        let mut patches = Vec::new();
        for _ in 0..r.count()? {
            patches.push(Patch {
                place: r.unsigned()?,
                feature: r.u32()?,
                bytes: r.blob()?.into(),
            });
        }
        let table = Self {
            format,
            features,
            areas,
            code,
            patches,
            units: Vec::new(),
            flows: Vec::new(),
            fixups: Vec::new(),
        };
        Ok((table, r))
    }

    /// The columns that both kinds start with: of the units their gaps, sizes, flags and alignments, of the flows where
    /// they come from, where they go and on what condition.
    pub(crate) fn read_units_and_flows(
        &mut self,
        units: usize,
        flows: usize,
        columns: &mut Columns<'_>,
    ) -> Result<()> {
        let [mut gaps, mut sizes, mut flags, mut aligns] = [
            columns.next()?,
            columns.next()?,
            columns.next()?,
            columns.next()?,
        ];
        let mut end = 0u64;
        for _ in 0..units {
            let start = end
                .checked_add(gaps.unsigned()?)
                .ok_or(Error::InvalidTable)?;
            let size = sizes.unsigned()?;
            end = start.checked_add(size).ok_or(Error::InvalidTable)?;
            let flags = flags.byte()?;
            let log2_align = if flags & STARTS_PIECE != 0 {
                aligns.byte()?
            } else {
                0
            };
            if log2_align >= 32 {
                return Err(Error::InvalidTable);
            }
            self.units.push(Unit {
                start,
                size,
                flags,
                log2_align,
            });
        }
        if self.units.first().is_some_and(|u| !u.starts_piece()) {
            return Err(Error::InvalidTable);
        }
        let [mut froms, mut tos, mut conditions] =
            [columns.next()?, columns.next()?, columns.next()?];
        let mut from = 0u64;
        for _ in 0..flows {
            from += froms.unsigned()?;
            let to = from
                .checked_add_signed(tos.signed()?)
                .ok_or(Error::InvalidTable)?;
            if from >= units as u64 || to >= units as u64 {
                return Err(Error::InvalidTable);
            }
            self.flows.push(Flow {
                from: from as u32,
                to: to as u32,
                condition: conditions.u32()?,
            });
        }
        Ok(())
    }

    /// A unit index as the table writes it: one more, so that 0 is [`NO_UNIT`].
    pub(crate) fn read_target(&self, written: u64) -> Result<u32> {
        match written.checked_sub(1) {
            None => Ok(NO_UNIT),
            Some(u) if u < self.units.len() as u64 => Ok(u as u32),
            Some(_) => Err(Error::InvalidTable),
        }
    }
}

/// `n { size }`, then the columns themselves.
pub(crate) struct Columns<'a> {
    sizes: Vec<usize>,
    next: usize,
    rest: Reader<'a>,
}

impl<'a> Columns<'a> {
    pub(crate) fn read(mut r: Reader<'a>) -> Result<Self> {
        let mut sizes = Vec::new();
        for _ in 0..r.count()? {
            sizes.push(r.count()?);
        }
        Ok(Self {
            sizes,
            next: 0,
            rest: r,
        })
    }

    pub(crate) fn next_bytes(&mut self) -> Result<&'a [u8]> {
        let size = *self.sizes.get(self.next).ok_or(Error::InvalidTable)?;
        self.next += 1;
        self.rest.take(size)
    }

    pub(crate) fn next(&mut self) -> Result<Reader<'a>> {
        self.next_bytes().map(Reader::new)
    }
}

#[cfg(feature = "tool")]
impl Table {
    /// `units n, flows n, fixups n`, then the columns of [`Self::read_units_and_flows`] and of every fixup its place,
    /// form, target and (for the forms that have one) extra.
    pub(crate) fn read_written_out(bytes: &[u8]) -> Result<Self> {
        let (mut table, mut r) = Self::read_header(bytes, KIND_WRITTEN_OUT)?;
        let [units, flows, fixups] = [r.count()?, r.count()?, r.count()?];
        let mut columns = Columns::read(r)?;
        table.read_units_and_flows(units, flows, &mut columns)?;
        let [mut places, mut forms, mut targets, mut extras] = [
            columns.next()?,
            columns.next()?,
            columns.next()?,
            columns.next()?,
        ];
        let mut place = 0u64;
        for _ in 0..fixups {
            place += places.unsigned()?;
            let form = Form::from_u8(forms.byte()?)?;
            let target = table.read_target(targets.unsigned()?)?;
            let extra = if matches!(form, Form::Page21 | Form::PageOff12) {
                extras.unsigned()? as u16
            } else {
                0
            };
            table.fixups.push(Fixup {
                place,
                form,
                target,
                extra,
            });
        }
        Ok(table.canonical())
    }

    /// One order for what has none: the flows of one unit, the fixups at one place.
    pub(crate) fn canonical(mut self) -> Self {
        for unit in self.units.iter_mut().filter(|u| !u.starts_piece()) {
            unit.log2_align = 0;
        }
        self.flows
            .sort_unstable_by_key(|f| (f.from, f.to, f.condition));
        self.fixups.sort_unstable();
        self
    }

    /// What [`Self::read_written_out`] reads.
    pub(crate) fn write_written_out(&self) -> Vec<u8> {
        use crate::bytes::Writer;
        let mut columns: [Writer; 11] = core::array::from_fn(|_| Writer::default());
        let [
            gaps,
            sizes,
            flags,
            aligns,
            froms,
            tos,
            conditions,
            places,
            forms,
            targets,
            extras,
        ] = &mut columns;
        let mut end = 0;
        for unit in &self.units {
            gaps.unsigned(unit.start - end);
            sizes.unsigned(unit.size);
            flags.bytes.push(unit.flags);
            if unit.starts_piece() {
                aligns.bytes.push(unit.log2_align);
            }
            end = unit.end();
        }
        let mut previous = 0;
        for flow in &self.flows {
            froms.unsigned(u64::from(flow.from - previous));
            tos.signed(i64::from(flow.to) - i64::from(flow.from));
            conditions.unsigned(flow.condition.into());
            previous = flow.from;
        }
        let mut previous = 0;
        for f in &self.fixups {
            places.unsigned(f.place - previous);
            forms.bytes.push(f.form as u8);
            targets.unsigned(if f.target == NO_UNIT {
                0
            } else {
                u64::from(f.target) + 1
            });
            if matches!(f.form, Form::Page21 | Form::PageOff12) {
                extras.unsigned(f.extra.into());
            }
            previous = f.place;
        }
        let mut out = self.write_header(KIND_WRITTEN_OUT);
        for count in [
            self.units.len(),
            self.flows.len(),
            self.fixups.len(),
            columns.len(),
        ] {
            out.unsigned(count as u64);
        }
        for column in &columns {
            out.unsigned(column.bytes.len() as u64);
        }
        for column in &columns {
            out.bytes.extend_from_slice(&column.bytes);
        }
        out.bytes
    }

    /// What [`Self::read_header`] reads.
    pub(crate) fn write_header(&self, kind: u8) -> crate::bytes::Writer {
        let mut w = crate::bytes::Writer::default();
        w.bytes.extend_from_slice(MAGIC);
        w.bytes.extend_from_slice(&[
            VERSION,
            kind,
            self.format.container as u8,
            self.format.arch as u8,
        ]);
        w.unsigned(self.features.len() as u64);
        for feature in &self.features {
            w.unsigned(feature.id.into());
            w.blob(&feature.name);
        }
        w.unsigned(self.areas.len() as u64);
        for area in &self.areas {
            w.unsigned(area.low);
            w.unsigned(area.high - area.low);
            w.unsigned(area.towards_high.into());
            w.blob(&area.fill);
        }
        w.unsigned(self.code.len() as u64);
        for &(low, high) in &self.code {
            w.unsigned(low);
            w.unsigned(high - low);
        }
        w.unsigned(self.patches.len() as u64);
        for patch in &self.patches {
            w.unsigned(patch.place);
            w.unsigned(patch.feature.into());
            w.blob(&patch.bytes);
        }
        w
    }
}
