//! The memory that test programs run on.
//!
//! From `Layout::base`, four granules: readable and writable, inaccessible, read-only, inaccessible. The data is at
//! the end of the first, so that an access that runs past it faults. The parts of the frame have made-up addresses.

use bun_engine_codegen::ir::{
    Access, AccessFlags, Boundary, Entity, Function, HeapRange, Slot, Type,
};

use super::datum::{Datum, Kind};
use super::random::{Random, mix};
use super::vocabulary::CALLEE_COUNT;

pub(crate) const GRANULE: u64 = 0x1_0000;
/// Accesses below this address fault.
pub(crate) const NULL_PAGE_END: u64 = 0x1000;

/// In the origin of a load whose address is added up without leaving the arrays.
pub(crate) const IN_OBJECT: u32 = 1 << 31;

/// Objects have a link to an object and three more fields, each a heap of its own.
pub(crate) const OBJECT_SIZE: u32 = 32;
pub(crate) const OBJECT_COUNT: u32 = 4;
pub(crate) const ARRAY_SIZE: u32 = 64;
pub(crate) const LINEAR_SIZE: u32 = 128;
pub(crate) const DATA_SIZE: u32 = OBJECT_SIZE * OBJECT_COUNT + 2 * ARRAY_SIZE + LINEAR_SIZE;

/// The read-only bytes start with the addresses of the objects and those of the callees.
pub(crate) const OBJECT_TABLE: u32 = 0;
pub(crate) const CALLEE_TABLE: u32 = OBJECT_TABLE + 8 * OBJECT_COUNT;
pub(crate) const CONSTANTS: u32 = CALLEE_TABLE + 8 * CALLEE_COUNT as u32;
pub(crate) const READ_ONLY_SIZE: u32 = CONSTANTS + 64;

/// Parameters and results in the frame are in these bytes above the frame pointer.
pub(crate) const ARGUMENTS_START: i32 = 16;
pub(crate) const ARGUMENTS_SIZE: u32 = 128;

pub(crate) const FRAME_POINTER: u64 = 0x0000_51a7_0000_0000;
const SLOTS_START: u64 = FRAME_POINTER - 0x1000_0000;

/// Every byte has a position, and is in the heaps whose range includes that.
pub(crate) mod position {
    pub(crate) const LINK: u32 = 0;
    pub(crate) const FIRST_ARRAY: u32 = 4;
    pub(crate) const SECOND_ARRAY: u32 = 5;
    pub(crate) const LINEAR: u32 = 6;
    pub(crate) const RESERVED: u32 = 7;
    pub(crate) const EVEN_SLOTS: u32 = 8;
    pub(crate) const ODD_SLOTS: u32 = 9;
    pub(crate) const READ_ONLY: u32 = 10;
    pub(crate) const COUNT: u32 = 11;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Region {
    Objects,
    Arrays,
    Linear,
    ReadOnly,
    /// The client's bytes below the frame pointer.
    Reserved,
    Arguments,
    Slot(Slot),
}

/// A part of the frame in which addresses keep their distances.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Segment {
    AroundFramePointer,
    Slot(Slot),
}

impl Region {
    pub(crate) fn is_writable(self) -> bool {
        !matches!(self, Self::ReadOnly | Self::Arguments)
    }

    pub(crate) fn segment(self) -> Option<Segment> {
        match self {
            Self::Reserved | Self::Arguments => Some(Segment::AroundFramePointer),
            Self::Slot(slot) => Some(Segment::Slot(slot)),
            _ => None,
        }
    }

    pub(crate) fn size(self, function: &Function) -> u32 {
        match self {
            Self::Objects => OBJECT_SIZE * OBJECT_COUNT,
            Self::Arrays => 2 * ARRAY_SIZE,
            Self::Linear => LINEAR_SIZE,
            Self::ReadOnly => READ_ONLY_SIZE,
            Self::Reserved => function.reserved_frame_bytes,
            Self::Arguments => ARGUMENTS_SIZE,
            Self::Slot(slot) => function.slots()[slot].size,
        }
    }

    pub(crate) fn position_at(self, offset: u32) -> u32 {
        match self {
            Self::Objects => position::LINK + offset % OBJECT_SIZE / 8,
            Self::Arrays => position::FIRST_ARRAY + offset / ARRAY_SIZE,
            Self::Linear => position::LINEAR,
            Self::Reserved => position::RESERVED,
            Self::Slot(slot) => position::EVEN_SLOTS + slot.index() as u32 % 2,
            Self::ReadOnly | Self::Arguments => position::READ_ONLY,
        }
    }
}

#[derive(Clone)]
pub(crate) struct Layout {
    /// A multiple of `GRANULE`.
    pub(crate) base: u64,
    pub(crate) callees: [u64; CALLEE_COUNT],
}

impl Default for Layout {
    /// For programs that are only interpreted.
    fn default() -> Self {
        Self {
            base: 0x0000_3c5a_1234_0000,
            callees: std::array::from_fn(|callee| 0x0000_2b00_0000_1000 + 64 * callee as u64),
        }
    }
}

impl Layout {
    pub(crate) fn data_start(&self) -> u64 {
        self.data_end() - u64::from(DATA_SIZE)
    }

    pub(crate) fn data_end(&self) -> u64 {
        self.base + GRANULE
    }

    pub(crate) fn read_only_start(&self) -> u64 {
        self.base + 2 * GRANULE
    }

    pub(crate) fn object(&self, index: u64) -> u64 {
        self.data_start() + index % u64::from(OBJECT_COUNT) * u64::from(OBJECT_SIZE)
    }

    pub(crate) fn start_of(&self, function: &Function, region: Region) -> u64 {
        match region {
            Region::Objects => self.data_start(),
            Region::Arrays => self.data_start() + u64::from(OBJECT_SIZE * OBJECT_COUNT),
            Region::Linear => self.data_end() - u64::from(LINEAR_SIZE),
            Region::ReadOnly => self.read_only_start(),
            Region::Reserved => FRAME_POINTER - u64::from(function.reserved_frame_bytes),
            Region::Arguments => FRAME_POINTER + ARGUMENTS_START as u64,
            Region::Slot(slot) => slot_address(function, slot),
        }
    }

    pub(crate) fn faults_at(&self, address: u64) -> bool {
        address < NULL_PAGE_END || (self.data_end()..self.read_only_start()).contains(&address)
    }
}

/// No more aligned than it has to be.
pub(crate) fn slot_address(function: &Function, slot: Slot) -> u64 {
    SLOTS_START + GRANULE * slot.index() as u64 + u64::from(function.slots()[slot].alignment)
}

/// What a program starts from.
#[derive(Clone, Debug)]
pub(crate) struct Input {
    pub(crate) entry: usize,
    pub(crate) args: Vec<u128>,
    pub(crate) data: Vec<u8>,
    pub(crate) read_only: Vec<u8>,
    /// The arguments that are passed in the frame go on top of these.
    pub(crate) arguments: Vec<u8>,
}

#[derive(Clone, Default, PartialEq, Eq)]
pub(crate) struct Bytes {
    pub(crate) bits: Vec<u8>,
    pub(crate) unknown: Vec<u8>,
}

impl Bytes {
    fn set(&mut self, bits: &[u8]) {
        self.bits.clear();
        self.bits.extend_from_slice(bits);
        self.unknown.clear();
        self.unknown.resize(bits.len(), 0);
    }

    fn read(&self, offset: usize, size: usize) -> Datum {
        let part = |bytes: &[u8]| {
            let mut buffer = [0; 16];
            buffer[..size].copy_from_slice(&bytes[offset..offset + size]);
            u128::from_le_bytes(buffer)
        };
        Datum::new(part(&self.bits), part(&self.unknown))
    }

    fn write(&mut self, offset: usize, size: usize, value: Datum) {
        let value = value.as_bits();
        self.bits[offset..offset + size].copy_from_slice(&value.bits.to_le_bytes()[..size]);
        self.unknown[offset..offset + size].copy_from_slice(&value.unknown.to_le_bytes()[..size]);
    }

    /// The offset of the first byte that is not allowed.
    pub(crate) fn first_conflict(&self, bits: &[u8]) -> Option<usize> {
        assert_eq!(self.bits.len(), bits.len());
        (0..bits.len()).find(|&i| (self.bits[i] ^ bits[i]) & !self.unknown[i] != 0)
    }
}

/// Up to eight bytes with one position.
#[derive(Clone, Copy)]
struct Word {
    offset: usize,
    size: usize,
    position: u32,
}

pub(crate) enum Fault {
    Trap,
    Undefined(&'static str),
    Open,
}

#[derive(Clone, Copy)]
pub(crate) struct Place {
    region: Region,
    /// In the bytes that hold the region.
    offset: usize,
}

#[derive(Clone, Default)]
pub(crate) struct Memory {
    pub(crate) data: Bytes,
    pub(crate) read_only: Bytes,
    pub(crate) arguments: Bytes,
    /// The reserved bytes and then the slots.
    pub(crate) frame: Bytes,
    pub(crate) slot_offsets: Vec<usize>,
    frame_words: Vec<Word>,
}

fn data_position(offset: u32) -> u32 {
    match offset.checked_sub(OBJECT_SIZE * OBJECT_COUNT) {
        None => Region::Objects.position_at(offset),
        Some(rest) => (position::FIRST_ARRAY + rest / ARRAY_SIZE).min(position::LINEAR),
    }
}

fn data_words() -> impl Iterator<Item = Word> {
    (0..DATA_SIZE).step_by(8).map(|offset| Word {
        offset: offset as usize,
        size: 8,
        position: data_position(offset),
    })
}

fn includes(range: HeapRange, position: u32) -> bool {
    (range.start..range.end).contains(&position)
}

fn hash(bytes: &Bytes, words: impl Iterator<Item = Word>, range: HeapRange) -> Option<u64> {
    let mut hash = 0;
    for word in words.filter(|word| includes(range, word.position)) {
        hash = mix(hash, bytes.read(word.offset, word.size).known().ok()?);
    }
    Some(hash)
}

impl Memory {
    /// The frame holds what `garbage` gives, or else anything.
    pub(crate) fn reset(
        &mut self,
        function: &Function,
        input: &Input,
        garbage: Option<&mut Random>,
    ) {
        self.data.set(&input.data);
        self.read_only.set(&input.read_only);
        self.arguments.set(&input.arguments);
        let entry = function.entries()[input.entry];
        let params = function.params(entry.block).iter();
        for ((&param, &boundary), &arg) in params.zip(function.entry_params(entry)).zip(&input.args)
        {
            if let Boundary::Frame(offset) = boundary {
                let (offset, ty) = ((offset - ARGUMENTS_START) as usize, function.type_of(param));
                self.arguments
                    .write(offset, ty.bytes() as usize, arg.into());
            }
        }

        self.slot_offsets.clear();
        self.frame_words.clear();
        let mut end = 0;
        let slots = function.slots().keys().map(Region::Slot);
        for region in std::iter::once(Region::Reserved).chain(slots) {
            let size = region.size(function) as usize;
            if region != Region::Reserved {
                self.slot_offsets.push(end);
            }
            self.frame_words
                .extend((0..size).step_by(8).map(|offset| Word {
                    offset: end + offset,
                    size: (size - offset).min(8),
                    position: region.position_at(0),
                }));
            end += size;
        }
        self.frame.bits.clear();
        self.frame.unknown.clear();
        match garbage {
            Some(random) => {
                self.frame
                    .bits
                    .extend((0..end).map(|_| random.next() as u8));
                self.frame.unknown.resize(end, 0);
            }
            None => {
                self.frame.bits.resize(end, 0);
                self.frame.unknown.resize(end, 0xff);
            }
        }
    }

    fn region_at(layout: &Layout, function: &Function, address: u64) -> Option<Region> {
        let slot = (address.wrapping_sub(SLOTS_START) / GRANULE) as usize;
        let slot = (slot < function.slots().len()).then(|| Region::Slot(Slot::from_index(slot)));
        [
            Region::Objects,
            Region::Arrays,
            Region::Linear,
            Region::ReadOnly,
            Region::Reserved,
            Region::Arguments,
        ]
        .into_iter()
        .chain(slot)
        .find(|&region| {
            address.wrapping_sub(layout.start_of(function, region)) < region.size(function).into()
        })
    }

    /// Whether the address is that of a byte in its segment, so that machine code has a counterpart for it.
    pub(crate) fn is_inside(layout: &Layout, function: &Function, address: Datum) -> bool {
        matches!(address.kind, Kind::FrameAddress(segment)
            if Self::region_at(layout, function, address.bits as u64).and_then(Region::segment) == Some(segment))
    }

    /// With `tracks_frame`, addresses in the frame are told from others.
    pub(crate) fn locate(
        &self,
        layout: &Layout,
        function: &Function,
        (base, offset): (Datum, i32),
        size: u32,
        access: Access,
        writes: bool,
        tracks_frame: bool,
    ) -> Result<Place, Fault> {
        if base.unknown != 0 || base.kind == Kind::Identity {
            return Err(Fault::Open);
        }
        let address = (base.bits as u64).wrapping_add_signed(offset.into());
        let last = address.wrapping_add(u64::from(size) - 1);
        if access.has(AccessFlags::ATOMIC) && address % u64::from(size) != 0 {
            return Err(Fault::Undefined("misaligned atomic access"));
        }
        let region = Self::region_at(layout, function, address);
        let segment = match base.kind {
            Kind::FrameAddress(segment) => Some(segment),
            _ => None,
        };
        if tracks_frame && segment != region.and_then(Region::segment) {
            return Err(Fault::Undefined(
                "address of the frame made up or led astray",
            ));
        }
        let starts_well = matches!(region, Some(Region::Linear)) || layout.faults_at(address);
        if starts_well && layout.faults_at(last) && last >= address {
            return Err(if access.has(AccessFlags::TRAPS) {
                Fault::Trap
            } else {
                Fault::Undefined("fault in an access that does not trap")
            });
        }
        let region = region.ok_or(Fault::Undefined("access outside memory"))?;
        // An access may run from one region of the data into the next.
        let is_data = matches!(region, Region::Objects | Region::Arrays | Region::Linear);
        let (first_address, available) = if is_data {
            (layout.data_start(), DATA_SIZE)
        } else {
            (layout.start_of(function, region), region.size(function))
        };
        let start = (address - first_address) as u32;
        if start + size > available {
            return Err(Fault::Undefined("access past the end of a region"));
        }
        if writes && !region.is_writable() {
            return Err(Fault::Undefined("write to read-only memory"));
        }
        if access.has(AccessFlags::IMMUTABLE) && region.is_writable() {
            return Err(Fault::Undefined("immutable load of mutable memory"));
        }
        let range = function.heap_range(access.heap());
        let is_in_heap = |word: u32| {
            let position = if is_data {
                data_position(8 * word)
            } else {
                region.position_at(0)
            };
            includes(range, position)
        };
        if !(start / 8..=(start + size - 1) / 8).all(is_in_heap) {
            return Err(Fault::Undefined("access outside its heap"));
        }
        let region_offset = match region {
            Region::Slot(slot) => self.slot_offsets[slot.index()],
            _ => 0,
        };
        Ok(Place {
            region,
            offset: region_offset + start as usize,
        })
    }

    pub(crate) fn read(&self, place: Place, size: u32) -> Datum {
        let bytes = match place.region {
            Region::Objects | Region::Arrays | Region::Linear => &self.data,
            Region::ReadOnly => &self.read_only,
            Region::Arguments => &self.arguments,
            Region::Reserved | Region::Slot(_) => &self.frame,
        };
        bytes.read(place.offset, size as usize)
    }

    pub(crate) fn write(&mut self, place: Place, size: u32, value: Datum) {
        let bytes = match place.region.segment() {
            None => &mut self.data,
            Some(_) => &mut self.frame,
        };
        bytes.write(place.offset, size as usize, value);
    }

    /// `None` if some of the bits are open.
    pub(crate) fn hash_data(&self, range: HeapRange) -> Option<u64> {
        hash(&self.data, data_words(), range)
    }

    pub(crate) fn hash_frame(&self, range: HeapRange) -> Option<u64> {
        hash(&self.frame, self.frame_words.iter().copied(), range)
    }

    /// Overwrites about one in `rarity` of the words in the range. Links keep pointing to objects.
    pub(crate) fn scramble(
        &mut self,
        layout: &Layout,
        range: HeapRange,
        seed: Option<u64>,
        rarity: u64,
    ) {
        let scramble = |bytes: &mut Bytes, word: Word, salt: u64| {
            if !includes(range, word.position) {
                return;
            }
            let Some(seed) = seed else {
                return bytes.write(word.offset, word.size, Datum::anything(Type::I64));
            };
            let bits = mix(seed, salt + word.offset as u64);
            if !(bits >> 40).is_multiple_of(rarity) {
                return;
            }
            let value = match (word.position, bits >> 60) {
                (position::LINK, _) => layout.object(bits),
                (_, 0..4) => bits % 16,
                (_, 4..8) => (((bits % 64) as f64 - 32.0) / 4.0).to_bits(),
                _ => mix(bits, 1),
            };
            bytes.write(word.offset, word.size, value.into());
        };
        data_words().for_each(|word| scramble(&mut self.data, word, 0));
        for &word in &self.frame_words {
            scramble(&mut self.frame, word, 1 << 20);
        }
    }
}
