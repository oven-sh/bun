use std::sync::atomic::{AtomicU64, Ordering};

use crate::paint::raster::IntRect;
use crate::platform::{Painter, Pixels};
use crate::win32::*;

/// Premultiplied BGRA, from the top.
pub struct Bitmap {
    handle: Handle,
    bits: *mut [u8; 4],
    pub size: (i32, i32),
}

impl Bitmap {
    pub fn new(width: i32, height: i32) -> Option<Bitmap> {
        let header = BitmapInfoHeader::of(width, -height);
        let mut bits = std::ptr::null_mut();
        let handle = CreateDIBSection(0, &header, DIB_RGB_COLORS, &mut bits, 0, 0);
        (handle != 0).then_some(Bitmap {
            handle,
            bits: bits.cast(),
            size: (width, height),
        })
    }

    pub fn of(width: u32, height: u32, bgra: impl Iterator<Item = [u8; 4]>) -> Option<Bitmap> {
        let mut bitmap = Bitmap::new(width as i32, height as i32)?;
        bitmap
            .pixels()
            .iter_mut()
            .zip(bgra)
            .for_each(|(to, from)| *to = from);
        Some(bitmap)
    }

    pub fn pixels(&mut self) -> &mut [[u8; 4]] {
        // SAFETY: the memory of the bitmap.
        unsafe {
            std::slice::from_raw_parts_mut(self.bits, self.size.0 as usize * self.size.1 as usize)
        }
    }

    pub fn handle(&self) -> Handle {
        self.handle
    }

    /// For whoever deletes it.
    pub fn leak(self) -> Handle {
        std::mem::ManuallyDrop::new(self).handle
    }
}

impl Drop for Bitmap {
    fn drop(&mut self) {
        // SAFETY: nothing borrows the pixels.
        unsafe { DeleteObject(self.handle) };
    }
}

/// `HICON`
pub struct Icon(pub Handle);

impl Icon {
    /// They are not premultiplied.
    fn new(width: u32, height: u32, rgba: &[u8]) -> Option<Icon> {
        let color = Bitmap::of(
            width,
            height,
            rgba.as_chunks().0.iter().map(|&[r, g, b, a]| [b, g, r, a]),
        )?;
        let clear = vec![0u8; width.div_ceil(16) as usize * 2 * height as usize];
        // SAFETY: a bit for each pixel, in rows of whole words. The icon has copies.
        unsafe {
            let mask = CreateBitmap(width as i32, height as i32, 1, 1, clear.as_ptr().cast());
            let icon = CreateIconIndirect(&IconInfo {
                f_icon: 1,
                hbm_mask: mask,
                hbm_color: color.handle,
                ..Default::default()
            });
            DeleteObject(mask);
            (icon != 0).then_some(Icon(icon))
        }
    }

    pub fn scaled(width: u32, height: u32, rgba: &[u8], side: i32) -> Option<Icon> {
        let image = crate::codec::Rgba {
            width,
            height,
            data: rgba.to_vec(),
        }
        .resized(side as u32, side as u32)?;
        Icon::new(image.width, image.height, &image.data)
    }

    pub fn decode(encoded: &[u8], side: i32) -> Option<Icon> {
        let image = crate::images::decode_still(encoded).ok()?;
        Icon::scaled(image.width, image.height, &image.data, side)
    }
}

impl Drop for Icon {
    fn drop(&mut self) {
        DestroyIcon(self.0);
    }
}

pub fn next_id() -> u64 {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

/// With room to grow for a window that has changed its size.
pub fn capacity_for(shown: (i32, i32), before: Option<(i32, i32)>) -> (i32, i32) {
    let spare = if before.is_some() { 256 } else { 0 };
    let fits = |size: &(i32, i32)| {
        size.0 >= shown.0 && size.1 >= shown.1 && size.0 * size.1 / 3 <= shown.0 * shown.1
    };
    before
        .filter(fits)
        .unwrap_or((shown.0 + spare, shown.1 + spare))
}

/// What a window shows.
pub struct Buffer {
    pub id: u64,
    device: Handle,
    pub bitmap: Bitmap,
    shown: (i32, i32),
}

impl Buffer {
    fn new((width, height): (i32, i32)) -> Option<Buffer> {
        let (bitmap, device) = (Bitmap::new(width, height)?, CreateCompatibleDC(0));
        SelectObject(device, bitmap.handle);
        Some(Buffer {
            id: next_id(),
            device,
            bitmap,
            shown: (0, 0),
        })
    }

    pub fn copy(&self, to: Handle, area: IntRect) {
        let area = area.intersect(IntRect::new(0, 0, self.shown.0, self.shown.1));
        BitBlt(
            to,
            area.left,
            area.top,
            area.width() as i32,
            area.height() as i32,
            self.device,
            area.left,
            area.top,
            SRCCOPY,
        );
    }

    /// With how many pixels it has sent.
    pub fn present(
        before: Option<Buffer>,
        window: Handle,
        shown: (i32, i32),
        paint: Painter,
    ) -> Option<(Buffer, i64)> {
        let capacity = capacity_for(shown, before.as_ref().map(|it| it.bitmap.size));
        let mut buffer = before
            .filter(|it| it.bitmap.size == capacity)
            .or_else(|| Buffer::new(capacity))?;
        let (id, width) = (buffer.id, buffer.bitmap.size.0 as usize);
        let painted = paint(Pixels {
            id,
            data: buffer.bitmap.pixels(),
            width,
            shown,
            platform_moves: false,
        });
        let damage = match std::mem::replace(&mut buffer.shown, shown) == shown {
            true => [painted.moved, painted.areas].concat(),
            false => vec![IntRect::new(0, 0, shown.0, shown.1)],
        };
        let device = GetDC(window);
        damage.iter().for_each(|area| buffer.copy(device, *area));
        ReleaseDC(window, device);
        GdiFlush();
        Some((buffer, damage.iter().map(|it| it.area()).sum()))
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        DeleteDC(self.device);
    }
}
