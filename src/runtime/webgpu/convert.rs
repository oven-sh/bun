//! What WebIDL cannot say about an argument.

use bun_collections::smallvec::SmallVec;
use bun_core::Unaligned;
use bun_dawn_sys::{self as dawn, Chain, StringView};
use bun_jsc::DOMExceptionCode;
use bun_jsc::bindgen::{BufferSource, JsHeap, JsLocal, Result};

use super::idl;

/// Dawn's messages quote a label that is there, even if it is empty.
pub(super) fn label(utf8: &[u8]) -> StringView<'_> {
    if utf8.is_empty() {
        return StringView::NULL;
    }
    utf8.into()
}

/// webgpu.h has no optional numbers: `u32::MAX` means that there is none. The number below it is just as invalid.
pub(super) fn optional_u32(value: Option<u32>) -> u32 {
    value.map_or(u32::MAX, |value| value.min(u32::MAX - 1))
}

/// `[EnforceRange]` keeps a size far below `WHOLE_SIZE`.
pub(super) fn size_or_whole(size: Option<u64>) -> u64 {
    size.unwrap_or(dawn::WHOLE_SIZE)
}

pub(super) fn extent<'a>(
    heap: &JsHeap<'a>,
    value: &idl::GPUExtent3D,
) -> Result<'a, dawn::Extent3D> {
    let (width, height, depth_or_array_layers) = match value {
        idl::GPUExtent3D::Dictionary(size) => (size.width, size.height, size.depth_or_array_layers),
        idl::GPUExtent3D::Sequence(size) => match **size {
            [width] => (width, 1, 1),
            [width, height] => (width, height, 1),
            [width, height, depth] => (width, height, depth),
            _ => {
                return Err(heap.type_error(format_args!(
                    "A GPUExtent3D sequence must have 1 to 3 elements. Received {}",
                    size.len()
                )));
            }
        },
    };
    Ok(dawn::Extent3D {
        width,
        height,
        depth_or_array_layers,
    })
}

fn origin<'a>(heap: &JsHeap<'a>, value: &idl::GPUOrigin3D) -> Result<'a, dawn::Origin3D> {
    let (x, y, z) = match value {
        idl::GPUOrigin3D::Dictionary(origin) => (origin.x, origin.y, origin.z),
        idl::GPUOrigin3D::Sequence(origin) => match **origin {
            [] => (0, 0, 0),
            [x] => (x, 0, 0),
            [x, y] => (x, y, 0),
            [x, y, z] => (x, y, z),
            _ => {
                return Err(heap.type_error(format_args!(
                    "A GPUOrigin3D sequence must have at most 3 elements. Received {}",
                    origin.len()
                )));
            }
        },
    };
    Ok(dawn::Origin3D { x, y, z })
}

pub(super) fn color<'a>(heap: &JsHeap<'a>, value: &idl::GPUColor) -> Result<'a, dawn::Color> {
    match value {
        &idl::GPUColor::Dictionary(idl::GPUColorDict { r, g, b, a }) => {
            Ok(dawn::Color { r, g, b, a })
        }
        idl::GPUColor::Sequence(color) => match **color {
            [r, g, b, a] => Ok(dawn::Color { r, g, b, a }),
            _ => Err(heap.type_error(format_args!(
                "A GPUColor sequence must have 4 elements. Received {}",
                color.len()
            ))),
        },
    }
}

pub(super) fn buffer_layout(value: &idl::GPUTexelCopyBufferLayout) -> dawn::TexelCopyBufferLayout {
    dawn::TexelCopyBufferLayout {
        offset: value.offset,
        bytes_per_row: optional_u32(value.bytes_per_row),
        rows_per_image: optional_u32(value.rows_per_image),
    }
}

pub(super) fn buffer_info<'a>(
    value: &idl::GPUTexelCopyBufferInfo<'a>,
) -> dawn::TexelCopyBufferInfo<'a> {
    dawn::TexelCopyBufferInfo {
        layout: buffer_layout(value),
        buffer: &value.buffer.handle,
    }
}

pub(super) fn texture_info<'a>(
    heap: &JsHeap<'a>,
    value: &idl::GPUTexelCopyTextureInfo<'a>,
) -> Result<'a, dawn::TexelCopyTextureInfo<'a>> {
    Ok(dawn::TexelCopyTextureInfo {
        texture: &value.texture.handle,
        mip_level: value.mip_level,
        origin: origin(heap, &value.origin)?,
        aspect: value.aspect.into(),
    })
}

pub(super) fn timestamp_writes(
    query_set: &super::GPUQuerySet,
    beginning_of_pass_write_index: Option<u32>,
    end_of_pass_write_index: Option<u32>,
) -> dawn::PassTimestampWrites<'_> {
    dawn::PassTimestampWrites {
        next_in_chain: Chain::END,
        query_set: &query_set.handle,
        beginning_of_pass_write_index: optional_u32(beginning_of_pass_write_index),
        end_of_pass_write_index: optional_u32(end_of_pass_write_index),
    }
}

/// For `writeBuffer()` and `setImmediates()`, which count in elements of `data`.
pub(super) fn with_elements<'a>(
    heap: &JsHeap<'a>,
    data: JsLocal<'a, BufferSource>,
    offset: u64,
    count: Option<u64>,
    f: impl FnOnce(&[u8]),
) -> Result<'a, ()> {
    let element_size = data.element_size();
    data.with_bytes(heap, |bytes| {
        let length = (bytes.len() / element_size) as u64;
        if offset > length {
            return Err(heap.dom_exception(
                DOMExceptionCode::OperationError,
                format_args!("The offset ({offset}) is past the end of the data ({length})"),
            ));
        }
        let count = count.unwrap_or(length - offset);
        if count > length - offset {
            return Err(heap.dom_exception(
                DOMExceptionCode::OperationError,
                format_args!(
                    "The size ({count}) from the offset ({offset}) goes past the end of the data ({length})"
                ),
            ));
        }
        let bytes = &bytes[offset as usize * element_size..][..count as usize * element_size];
        if !bytes.len().is_multiple_of(4) {
            return Err(heap.dom_exception(
                DOMExceptionCode::OperationError,
                format_args!("The size in bytes ({}) is not a multiple of 4", bytes.len()),
            ));
        }
        f(bytes);
        Ok(())
    })
}

/// A copy: Dawn reads them once to validate them and again to use them, and another thread can write to `data`.
pub(super) fn dynamic_offsets<'a>(
    heap: &JsHeap<'a>,
    data: JsLocal<'a, BufferSource>,
    start: u64,
    count: u32,
) -> Result<'a, SmallVec<[u32; 16]>> {
    data.with_bytes(heap, |bytes| {
        let elements = Unaligned::<u32>::slice_of(bytes);
        let end = start + u64::from(count);
        match elements.get(start as usize..end as usize) {
            Some(offsets) => Ok(offsets.iter().map(|offset| offset.get()).collect()),
            None => Err(heap.range_error(format_args!(
                "The dynamic offsets end at {end}, which is past the end of the data ({})",
                elements.len()
            ))),
        }
    })
}
