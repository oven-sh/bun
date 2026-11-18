//! Buffers, and where vertices come from.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use super::context::{Context, Extension, MAX_ATTRIBUTES, dirty};
use super::decoder::{
    Answer, NO_MEMORY, Result, bad_enum, bad_state, bytes_of_mut, check_enum, check_state,
    check_value,
};
use super::gl::*;
use super::native::{Gl, Kind, Name};
use super::objects::{Bytes, Handle, id_of, is};
use super::pixels::zeroed;
use crate::abi_webgl::{answer, scalar};

/// Those that belong to the context.
pub const TARGETS: [u32; 7] = [
    ARRAY_BUFFER,
    COPY_READ_BUFFER,
    COPY_WRITE_BUFFER,
    PIXEL_PACK_BUFFER,
    PIXEL_UNPACK_BUFFER,
    UNIFORM_BUFFER,
    TRANSFORM_FEEDBACK_BUFFER,
];
pub const PACK: usize = 3;
pub const UNPACK: usize = 4;

/// Offset, count, type, and the largest index.
type Scanned = [u32; 4];

#[derive(Default)]
struct Indices {
    bytes: Vec<u8>,
    scanned: Vec<Scanned>,
    _memory: Bytes,
}

pub struct Buffer {
    pub handle: Handle,
    pub name: Name,
    pub size: Bytes,
    usage: Cell<u32>,
    /// That is settled when it is bound for the first time.
    has_indices: Cell<Option<bool>>,
    indices: RefCell<Indices>,
    /// How many transform feedback objects write to it.
    pub captures: Cell<u32>,
}

fn largest<const N: usize, T: Ord + Copy + Into<u32>>(
    bytes: &[u8],
    read: fn([u8; N]) -> T,
    skip_last: fn(T) -> T,
    restarts: bool,
) -> u32 {
    let values = bytes.as_chunks().0.iter().map(|it| read(*it));
    if restarts {
        values.map(skip_last).max().map_or(0, Into::into)
    } else {
        values.max().map_or(0, |it| it.into().saturating_add(1))
    }
}

impl Buffer {
    pub fn new(handle: Handle, _: u32, _: &Context) -> Buffer {
        Buffer {
            handle,
            name: Name::new(Kind::Buffer),
            size: Bytes::default(),
            usage: STATIC_DRAW.into(),
            has_indices: None.into(),
            indices: RefCell::default(),
            captures: 0.into(),
        }
    }

    /// How many vertices these indices, which are inside of the buffer, need.
    pub fn vertices_for(&self, offset: u32, count: u32, kind: u32, restarts: bool) -> u32 {
        const SLOTS: usize = 64;
        let Indices { bytes, scanned, .. } = &mut *self.indices.borrow_mut();
        scanned.resize(SLOTS, [0; 4]);
        let known = &mut scanned[(offset.wrapping_mul(0x9E37_79B1)
            ^ count.wrapping_mul(0x85EB_CA6B)) as usize
            >> 20
            & (SLOTS - 1)];
        if known[..3] != [offset, count, kind] {
            let bytes = &bytes[offset as usize..];
            *known = [
                offset,
                count,
                kind,
                match kind {
                    UNSIGNED_BYTE => largest(
                        &bytes[..count as usize],
                        u8::from_ne_bytes,
                        |it| it.wrapping_add(1),
                        restarts,
                    ),
                    UNSIGNED_SHORT => largest(
                        &bytes[..count as usize * 2],
                        u16::from_ne_bytes,
                        |it| it.wrapping_add(1),
                        restarts,
                    ),
                    _ => largest(
                        &bytes[..count as usize * 4],
                        u32::from_ne_bytes,
                        |it| it.wrapping_add(1),
                        restarts,
                    ),
                },
            ];
        }
        known[3]
    }

    fn write_indices(&self, offset: usize, bytes: &[u8]) {
        if self.has_indices.get() == Some(true) {
            let mut indices = self.indices.borrow_mut();
            indices.bytes[offset..][..bytes.len()].copy_from_slice(bytes);
            indices.scanned.clear();
        }
    }

    pub fn contains(&self, offset: usize, size: u64) -> bool {
        (offset as u64).saturating_add(size) <= self.size.get()
    }
}

#[derive(Clone)]
pub struct Range {
    pub buffer: Rc<Buffer>,
    pub offset: usize,
    /// 0 for all.
    pub size: usize,
    /// How much of it the driver knows of.
    bound: Cell<Option<u64>>,
}

impl Range {
    /// Not before it is used, because not all drivers take one that sticks out of its buffer.
    pub fn bind(&self, gl: &Gl, target: u32, index: u32) {
        let available = self.available();
        if self.bound.replace(Some(available)) != Some(available) {
            gl.bind_buffer(target, self.buffer.name.0);
            match available & !3 {
                0 => gl.bind_buffer_base(target, index, self.buffer.name.0),
                size => gl.bind_buffer_range(
                    target,
                    index,
                    self.buffer.name.0,
                    self.offset,
                    size as usize,
                ),
            }
        }
    }

    pub fn available(&self) -> u64 {
        let rest = self.buffer.size.get().saturating_sub(self.offset as u64);
        if self.size == 0 {
            rest
        } else {
            rest.min(self.size as u64)
        }
    }
}

pub struct Attribute {
    pub buffer: Option<Rc<Buffer>>,
    pub size: u32,
    pub kind: u32,
    pub is_normalized: bool,
    pub is_integer: bool,
    pub stride: u32,
    pub offset: usize,
    pub divisor: u32,
    /// Of one.
    pub bytes: u32,
}

pub struct VertexArray {
    pub handle: Handle,
    pub name: Name,
    pub attributes: RefCell<[Attribute; MAX_ATTRIBUTES]>,
    pub enabled: Cell<u32>,
    pub natively_enabled: Cell<u32>,
    pub elements: RefCell<Option<Rc<Buffer>>>,
}

impl VertexArray {
    pub fn of(handle: Handle) -> VertexArray {
        let attribute = |_| Attribute {
            buffer: None,
            size: 4,
            kind: FLOAT,
            is_normalized: false,
            is_integer: false,
            stride: 0,
            offset: 0,
            divisor: 0,
            bytes: 16,
        };
        let (enabled, natively_enabled, elements) = Default::default();
        VertexArray {
            handle,
            name: Name::new(Kind::VertexArray),
            attributes: std::array::from_fn(attribute).into(),
            enabled,
            natively_enabled,
            elements,
        }
    }

    pub fn new(handle: Handle, _: u32, _: &Context) -> VertexArray {
        VertexArray::of(handle)
    }
}

impl Context {
    fn buffer_slot(&self, target: u32) -> Result<usize> {
        TARGETS[..if self.is_webgl2() { 7 } else { 1 }]
            .iter()
            .position(|it| *it == target)
            .map_or(bad_enum("unknown target"), Ok)
    }

    fn settle_kind(target: u32, buffer: &Option<Rc<Buffer>>) -> Result {
        let Some(buffer) = buffer else { return Ok(()) };
        let (is_for_indices, has_indices) =
            (target == ELEMENT_ARRAY_BUFFER, buffer.has_indices.get());
        let is_valid = matches!(target, COPY_READ_BUFFER | COPY_WRITE_BUFFER)
            || has_indices.is_none_or(|it| it == is_for_indices);
        check_state(is_valid, "a buffer holds either indices or other data")?;
        buffer.has_indices.set(has_indices.or(Some(is_for_indices)));
        buffer.handle.was_bound.set(true);
        Ok(())
    }

    pub fn bind_buffer(&mut self, target: u32, buffer: Option<Rc<Buffer>>) -> Result {
        if target == ELEMENT_ARRAY_BUFFER {
            Context::settle_kind(target, &buffer)?;
            self.gl
                .bind_buffer(target, buffer.as_ref().map_or(0, |it| it.name.0));
            self.vertex_array.elements.replace(buffer);
            return Ok(());
        }
        let slot = self.buffer_slot(target)?;
        Context::settle_kind(target, &buffer)?;
        self.buffers[slot] = buffer;
        Ok(())
    }

    pub fn bind_buffer_base(
        &mut self,
        target: u32,
        index: u32,
        buffer: Option<Rc<Buffer>>,
    ) -> Result {
        self.bind_indexed(target, index, buffer, 0, 0)
    }

    pub fn bind_buffer_range(
        &mut self,
        target: u32,
        index: u32,
        buffer: Option<Rc<Buffer>>,
        offset: usize,
        size: usize,
    ) -> Result {
        let [offset_alignment, size_alignment] = if target == UNIFORM_BUFFER {
            [self.limits.uniform_alignment as usize, 1]
        } else {
            [4, 4]
        };
        check_enum(
            matches!(target, UNIFORM_BUFFER | TRANSFORM_FEEDBACK_BUFFER),
            "unknown target",
        )?;
        check_value(
            (size > 0 || buffer.is_none())
                && offset.is_multiple_of(offset_alignment)
                && size.is_multiple_of(size_alignment),
            "the range is empty, negative or not aligned",
        )?;
        self.bind_indexed(target, index, buffer, offset, size)
    }

    fn bind_indexed(
        &mut self,
        target: u32,
        index: u32,
        buffer: Option<Rc<Buffer>>,
        offset: usize,
        size: usize,
    ) -> Result {
        check_enum(
            matches!(target, UNIFORM_BUFFER | TRANSFORM_FEEDBACK_BUFFER),
            "unknown target",
        )?;
        let (slot, is_uniform) = (self.buffer_slot(target)?, target == UNIFORM_BUFFER);
        check_value(
            index
                < if is_uniform {
                    self.limits.uniform_bindings
                } else {
                    self.limits.shaders.separate_feedback_attributes
                },
            "the index is too large",
        )?;
        check_state(
            is_uniform || !self.feedback.is_active(),
            "not during transform feedback",
        )?;
        Context::settle_kind(target, &buffer)?;
        let range = buffer.clone().map(|buffer| Range {
            buffer,
            offset,
            size,
            bound: None.into(),
        });
        if is_uniform {
            self.uniform_buffers[index as usize] = range;
        } else {
            self.feedback.buffers.borrow_mut()[index as usize] = range;
        }
        self.buffers[slot] = buffer;
        self.dirty |= dirty::BUFFERS;
        Ok(())
    }

    pub fn forget_buffer(&mut self, buffer: &Rc<Buffer>) {
        let is_it = |it: &mut Rc<Buffer>| Rc::ptr_eq(it, buffer);
        self.buffers
            .iter_mut()
            .for_each(|it| drop(it.take_if(is_it)));
        self.vertex_array
            .attributes
            .borrow_mut()
            .iter_mut()
            .for_each(|it| drop(it.buffer.take_if(is_it)));
        if self
            .vertex_array
            .elements
            .borrow_mut()
            .take_if(is_it)
            .is_some()
        {
            self.gl.bind_buffer(ELEMENT_ARRAY_BUFFER, 0);
        }
        self.uniform_buffers
            .iter_mut()
            .chain(&mut *self.feedback.buffers.borrow_mut())
            .for_each(|range| drop(range.take_if(|it| is_it(&mut it.buffer))));
        self.dirty |= dirty::BUFFERS;
    }

    /// It is bound for transform feedback and for something else.
    pub fn is_contested(&self, buffer: &Rc<Buffer>) -> bool {
        let is_in = |ranges: &[Option<Range>]| {
            ranges
                .iter()
                .flatten()
                .any(|it| Rc::ptr_eq(&it.buffer, buffer))
        };
        is_in(&*self.feedback.buffers.borrow())
            && (self.buffers[..6].iter().any(|it| is(it, buffer))
                || is_in(&self.uniform_buffers)
                || self
                    .vertex_array
                    .attributes
                    .borrow()
                    .iter()
                    .any(|it| is(&it.buffer, buffer)))
    }

    fn bound_buffer(&self, target: u32) -> Result<Rc<Buffer>> {
        let buffer = if target == ELEMENT_ARRAY_BUFFER {
            self.vertex_array.elements.borrow().clone()
        } else {
            self.buffers[self.buffer_slot(target)?].clone()
        };
        buffer.map_or(bad_state("this target has no buffer"), Ok)
    }

    fn usable_buffer(&self, target: u32) -> Result<Rc<Buffer>> {
        let buffer = self.bound_buffer(target)?;
        let is_written = self.feedback.is_active() && target == TRANSFORM_FEEDBACK_BUFFER;
        check_state(
            !is_written && !self.is_contested(&buffer),
            "transform feedback has the buffer",
        )
        .map(|()| buffer)
    }

    /// Zeros if there are no bytes.
    pub fn buffer_data(&mut self, target: u32, usage: u32, size: usize, bytes: &[u8]) -> Result {
        check_enum(
            matches!(usage, STREAM_DRAW | STATIC_DRAW | DYNAMIC_DRAW)
                || self.is_webgl2()
                    && (STREAM_DRAW..=DYNAMIC_COPY).contains(&usage)
                    && usage & 3 != 3,
            "unknown usage",
        )?;
        let (buffer, size) = (
            self.usable_buffer(target)?,
            if bytes.is_empty() { size } else { bytes.len() },
        );
        check_value(size <= i32::MAX as usize, "a buffer has less than 2 GiB")?;
        check_state(
            buffer.captures.get() == 0,
            "transform feedback is writing to the buffer",
        )?;
        let keeps = buffer.has_indices.get() == Some(true);
        self.dirty |= dirty::BUFFERS;
        let memory = Bytes::default();
        memory.set(if keeps { size as u64 } else { 0 })?;
        buffer.size.set(size as u64)?;
        let mut copy = if keeps || bytes.is_empty() {
            zeroed(size)
        } else {
            Some(Vec::new())
        };
        let result = copy.as_mut().map_or(Err(NO_MEMORY), |copy| {
            if keeps {
                copy[..bytes.len()].copy_from_slice(bytes);
            }
            self.gl.bind_buffer(COPY_WRITE_BUFFER, buffer.name.0);
            // SAFETY: there are so many bytes.
            self.allocate(|it| unsafe {
                (it.gl.buffer_data)(
                    COPY_WRITE_BUFFER,
                    size,
                    if bytes.is_empty() {
                        copy.as_ptr()
                    } else {
                        bytes.as_ptr()
                    },
                    usage,
                )
            })
        });
        buffer.indices.replace(Indices {
            bytes: copy.filter(|_| keeps && result.is_ok()).unwrap_or_default(),
            scanned: Vec::new(),
            _memory: memory,
        });
        buffer.usage.set(usage);
        result.inspect_err(|_| _ = buffer.size.set(0))
    }

    pub fn buffer_sub_data(&mut self, target: u32, offset: usize, bytes: &[u8]) -> Result {
        let buffer = self.usable_buffer(target)?;
        check_value(
            buffer.contains(offset, bytes.len() as u64),
            "the range ends outside of the buffer",
        )?;
        buffer.write_indices(offset, bytes);
        self.gl.bind_buffer(COPY_WRITE_BUFFER, buffer.name.0);
        self.gl.write_buffer(COPY_WRITE_BUFFER, offset, bytes);
        Ok(())
    }

    pub fn copy_buffer_sub_data(
        &mut self,
        from: u32,
        to: u32,
        from_offset: usize,
        to_offset: usize,
        size: usize,
    ) -> Result {
        let (from, to) = (self.usable_buffer(from)?, self.usable_buffer(to)?);
        check_value(
            from.contains(from_offset, size as u64) && to.contains(to_offset, size as u64),
            "the range ends outside of the buffer",
        )?;
        check_value(
            !Rc::ptr_eq(&from, &to) || from_offset.abs_diff(to_offset) >= size,
            "source and destination overlap",
        )?;
        check_state(
            from.has_indices == to.has_indices,
            "only one of the buffers holds indices",
        )?;
        if to.has_indices.get() == Some(true) && Rc::ptr_eq(&from, &to) {
            to.indices
                .borrow_mut()
                .bytes
                .copy_within(from_offset..from_offset + size, to_offset);
            to.write_indices(0, &[]);
        } else if to.has_indices.get() == Some(true) {
            to.write_indices(
                to_offset,
                &from.indices.borrow().bytes[from_offset..][..size],
            );
        }
        self.gl.bind_buffer(COPY_READ_BUFFER, from.name.0);
        self.gl.bind_buffer(COPY_WRITE_BUFFER, to.name.0);
        self.gl.copy_buffer_sub_data(
            COPY_READ_BUFFER,
            COPY_WRITE_BUFFER,
            from_offset,
            to_offset,
            size,
        );
        Ok(())
    }

    /// The answer is the bytes.
    pub fn get_buffer_sub_data(&mut self, target: u32, offset: usize, size: usize) -> Result {
        const MAP_READ_BIT: u32 = 1;
        let buffer = self.usable_buffer(target)?;
        check_value(
            buffer.contains(offset, size as u64),
            "the range ends outside of the buffer",
        )?;
        if size == 0 {
            return Ok(());
        }
        self.answer
            .try_reserve(size.div_ceil(4))
            .or(Err(NO_MEMORY))?;
        self.answer.resize(size.div_ceil(4), 0);
        self.gl.bind_buffer(COPY_READ_BUFFER, buffer.name.0);
        // SAFETY: what is mapped is as large as it was asked for, until it is unmapped.
        unsafe {
            let mapped = (self.gl.map_buffer_range)(COPY_READ_BUFFER, offset, size, MAP_READ_BIT);
            if mapped.is_null() {
                return Err(NO_MEMORY);
            }
            bytes_of_mut(&mut self.answer)[..size]
                .copy_from_slice(std::slice::from_raw_parts(mapped, size));
        }
        self.gl.unmap_buffer(COPY_READ_BUFFER);
        Ok(())
    }

    pub fn get_buffer_parameter(&mut self, target: u32, name: u32) -> Result<Answer> {
        let buffer = self.bound_buffer(target)?;
        match name {
            BUFFER_SIZE => Ok(Answer::Uint(buffer.size.get() as u32)),
            BUFFER_USAGE => Ok(Answer::Uint(buffer.usage.get())),
            _ => bad_enum("unknown pname"),
        }
    }

    pub fn bind_vertex_array(&mut self, array: Option<Rc<VertexArray>>) {
        self.vertex_array = array.unwrap_or_else(|| self.default_vertex_array.clone());
        self.vertex_array.handle.was_bound.set(true);
        self.gl.bind_vertex_array(self.vertex_array.name.0);
        self.dirty |= dirty::VERTICES;
    }

    pub fn forget_vertex_array(&mut self, array: &Rc<VertexArray>) {
        if Rc::ptr_eq(array, &self.vertex_array) {
            self.bind_vertex_array(None);
        }
    }

    fn check_attribute(&self, index: u32) -> Result {
        check_value(
            index < self.limits.shaders.vertex_attributes,
            "the index is too large",
        )
    }

    pub fn enable_vertex_attrib_array(&mut self, index: u32) -> Result {
        self.check_attribute(index)?;
        self.vertex_array.enabled.update(|it| it | 1 << index);
        self.dirty |= dirty::VERTICES;
        Ok(())
    }

    pub fn disable_vertex_attrib_array(&mut self, index: u32) -> Result {
        self.check_attribute(index)?;
        self.vertex_array.enabled.update(|it| it & !(1 << index));
        self.dirty |= dirty::VERTICES;
        Ok(())
    }

    pub fn vertex_attrib(
        &mut self,
        index: u32,
        scalar: u32,
        x: u32,
        y: u32,
        z: u32,
        w: u32,
    ) -> Result {
        self.check_attribute(index)?;
        let values = [x, y, z, w];
        match scalar {
            scalar::FLOAT => self.gl.vertex_attrib_4fv(index, &values),
            scalar::INT => self.gl.vertex_attrib_i4iv(index, &values),
            _ => self.gl.vertex_attrib_i4uiv(index, &values),
        }
        if std::mem::replace(
            &mut self.generic_attributes[index as usize],
            (scalar, values),
        )
        .0 != scalar
        {
            self.dirty |= dirty::VERTICES;
        }
        Ok(())
    }

    pub fn vertex_attrib_divisor(&mut self, index: u32, divisor: u32) -> Result {
        self.check_attribute(index)?;
        self.vertex_array.attributes.borrow_mut()[index as usize].divisor = divisor;
        self.gl.vertex_attrib_divisor(index, divisor);
        self.dirty |= dirty::VERTICES;
        Ok(())
    }

    fn point(
        &mut self,
        index: u32,
        size: u32,
        kind: u32,
        is_normalized: Option<bool>,
        stride: u32,
        offset: usize,
    ) -> Result {
        self.check_attribute(index)?;
        let is_packed = matches!(kind, INT_2_10_10_10_REV | UNSIGNED_INT_2_10_10_10_REV);
        let unit = match kind {
            BYTE | UNSIGNED_BYTE => 1,
            SHORT | UNSIGNED_SHORT => 2,
            INT | UNSIGNED_INT if self.is_webgl2() => 4,
            FLOAT if is_normalized.is_some() => 4,
            HALF_FLOAT if is_normalized.is_some() && self.is_webgl2() => 2,
            _ if is_packed && is_normalized.is_some() && self.is_webgl2() => 4,
            _ => return bad_enum("unknown type"),
        };
        check_value(
            (1..=4).contains(&size) && stride <= 255,
            "size or stride is out of range",
        )?;
        check_state(size == 4 || !is_packed, "packed types have 4 components")?;
        check_state(
            stride.is_multiple_of(unit) && offset.is_multiple_of(unit as usize),
            "stride and offset have to be multiples of the size of the type",
        )?;
        let buffer = self.buffers[0].clone();
        check_state(
            buffer.is_some() || offset == 0,
            "an offset needs an ARRAY_BUFFER",
        )?;
        if let Some(buffer) = &buffer {
            self.gl.bind_buffer(ARRAY_BUFFER, buffer.name.0);
            match is_normalized {
                Some(is_normalized) => {
                    self.gl
                        .vertex_attrib_pointer(index, size, kind, is_normalized, stride, offset)
                }
                None => self
                    .gl
                    .vertex_attrib_i_pointer(index, size, kind, stride, offset),
            }
        }
        let attribute = &mut self.vertex_array.attributes.borrow_mut()[index as usize];
        let (is_integer, is_normalized, bytes) = (
            is_normalized.is_none(),
            is_normalized == Some(true),
            if is_packed { 4 } else { size * unit },
        );
        *attribute = Attribute {
            buffer,
            size,
            kind,
            is_normalized,
            is_integer,
            stride,
            offset,
            bytes,
            divisor: attribute.divisor,
        };
        self.dirty |= dirty::VERTICES;
        Ok(())
    }

    pub fn vertex_attrib_pointer(
        &mut self,
        index: u32,
        size: u32,
        kind: u32,
        is_normalized: bool,
        stride: u32,
        offset: usize,
    ) -> Result {
        self.point(index, size, kind, Some(is_normalized), stride, offset)
    }

    pub fn vertex_attrib_i_pointer(
        &mut self,
        index: u32,
        size: u32,
        kind: u32,
        stride: u32,
        offset: usize,
    ) -> Result {
        self.point(index, size, kind, None, stride, offset)
    }

    pub fn get_vertex_attrib(&mut self, index: u32, name: u32) -> Result<Answer> {
        self.check_attribute(index)?;
        let (it, (scalar, values)) = (
            &self.vertex_array.attributes.borrow()[index as usize],
            self.generic_attributes[index as usize],
        );
        Ok(match name {
            VERTEX_ATTRIB_ARRAY_BUFFER_BINDING => Answer::Object(id_of(it.buffer.as_ref())),
            VERTEX_ATTRIB_ARRAY_ENABLED => {
                Answer::Boolean(self.vertex_array.enabled.get() >> index & 1 != 0)
            }
            VERTEX_ATTRIB_ARRAY_NORMALIZED => Answer::Boolean(it.is_normalized),
            VERTEX_ATTRIB_ARRAY_SIZE => Answer::Uint(it.size),
            VERTEX_ATTRIB_ARRAY_STRIDE => Answer::Uint(it.stride),
            VERTEX_ATTRIB_ARRAY_TYPE => Answer::Uint(it.kind),
            VERTEX_ATTRIB_ARRAY_INTEGER if self.is_webgl2() => Answer::Boolean(it.is_integer),
            VERTEX_ATTRIB_ARRAY_DIVISOR
                if self.features.is_webgl2_or_has(Extension::InstancedArrays) =>
            {
                Answer::Uint(it.divisor)
            }
            CURRENT_VERTEX_ATTRIB => Answer::List(
                [answer::FLOAT_ARRAY, answer::INT_ARRAY, answer::UINT_ARRAY]
                    [scalar.min(2) as usize],
                values.into(),
            ),
            _ => return bad_enum("unknown pname"),
        })
    }

    pub fn get_vertex_attrib_offset(&mut self, index: u32, name: u32) -> Result<Answer> {
        self.check_attribute(index)?;
        check_enum(name == VERTEX_ATTRIB_ARRAY_POINTER, "unknown pname")?;
        Ok(Answer::Uint(
            self.vertex_array.attributes.borrow()[index as usize].offset as u32,
        ))
    }
}
