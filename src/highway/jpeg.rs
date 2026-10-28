//! The kernels of `bun_jpeg` that work on a row of samples (`src/jsc/bindings/highway_jpeg.cpp`).
//!
//! Each returns false, having done nothing, for a row that is too short for vectors and for an output without room for the
//! result. The caller then does the row itself. Of rows of different lengths, the shortest counts.

unsafe extern "C" {
    fn highway_jpeg_from_ycc(
        y: *const u8,
        cb: *const u8,
        cr: *const u8,
        k: *const u8,
        out: *mut u8,
        n: usize,
    ) -> bool;

    fn highway_jpeg_to_ycc(rgba: *const u8, y: *mut u8, cb: *mut u8, cr: *mut u8, n: usize)
    -> bool;

    fn highway_jpeg_h2v2_downsample(
        row0: *const u8,
        row1: *const u8,
        out: *mut u8,
        n: usize,
    ) -> bool;

    fn highway_jpeg_h2v1_fancy(input: *const u8, out: *mut u8, n: usize) -> bool;

    fn highway_jpeg_h2v2_fancy(near: *const u8, far: *const u8, out: *mut u8, n: usize) -> bool;
}

/// Appends a pixel for every sample of the rows: `[r, g, b, 255]`, or `[255 - r, 255 - g, 255 - b, k]` with a row of `k`.
/// `out` does not grow: it has to have the room.
#[inline(always)]
#[must_use]
pub fn from_ycc(y: &[u8], cb: &[u8], cr: &[u8], k: Option<&[u8]>, out: &mut Vec<[u8; 4]>) -> bool {
    let n = y.len().min(cb.len()).min(cr.len());
    let n = k.map_or(n, |k| n.min(k.len()));
    let spare = out.spare_capacity_mut();
    if spare.len() < n {
        return false;
    }
    // SAFETY: each row has `n` bytes to read, and `spare` has room for `n` pixels of 4 bytes (checked above).
    let done = unsafe {
        highway_jpeg_from_ycc(
            y.as_ptr(),
            cb.as_ptr(),
            cr.as_ptr(),
            k.map_or(core::ptr::null(), <[u8]>::as_ptr),
            spare.as_mut_ptr().cast::<u8>(),
            n,
        )
    };
    if done {
        // SAFETY: `n` more pixels are within the capacity (checked above), and the kernel has written all of them.
        unsafe { out.set_len(out.len() + n) };
    }
    done
}

/// The Y, Cb and Cr of every pixel.
#[inline(always)]
#[must_use]
pub fn to_ycc(rgba: &[[u8; 4]], y: &mut [u8], cb: &mut [u8], cr: &mut [u8]) -> bool {
    let n = rgba.len().min(y.len()).min(cb.len()).min(cr.len());
    // SAFETY: `rgba` has `4 * n` bytes to read, and each of the others has room for `n`.
    unsafe {
        highway_jpeg_to_ycc(
            rgba.as_ptr().cast::<u8>(),
            y.as_mut_ptr(),
            cb.as_mut_ptr(),
            cr.as_mut_ptr(),
            n,
        )
    }
}

/// The mean of 2 by 2 samples, two of them at a time: a half is rounded down for the first and up for the second.
#[inline(always)]
#[must_use]
pub fn h2v2_downsample(row0: &[[u8; 4]], row1: &[[u8; 4]], out: &mut [[u8; 2]]) -> bool {
    let n = row0.len().min(row1.len()).min(out.len());
    // SAFETY: `row0` and `row1` have `4 * n` bytes to read and `out` has room for `2 * n`, an even number.
    unsafe {
        highway_jpeg_h2v2_downsample(
            row0.as_ptr().cast::<u8>(),
            row1.as_ptr().cast::<u8>(),
            out.as_mut_ptr().cast::<u8>(),
            n * 2,
        )
    }
}

/// The two samples that every sample of `input` turns into when the row gets twice as wide by linear interpolation.
#[inline(always)]
#[must_use]
pub fn h2v1_fancy(input: &[u8], out: &mut [[u8; 2]]) -> bool {
    let n = input.len();
    // SAFETY: `input` has `n` bytes to read and `out` has room for `2 * n`.
    out.len() >= n
        && unsafe { highway_jpeg_h2v1_fancy(input.as_ptr(), out.as_mut_ptr().cast::<u8>(), n) }
}

/// [`h2v1_fancy`] of 3/4 of `near` and 1/4 of `far`, without rounding in between.
#[inline(always)]
#[must_use]
pub fn h2v2_fancy(near: &[u8], far: &[u8], out: &mut [[u8; 2]]) -> bool {
    let n = near.len().min(far.len());
    // SAFETY: `near` and `far` have `n` bytes to read and `out` has room for `2 * n`.
    out.len() >= n
        && unsafe {
            highway_jpeg_h2v2_fancy(
                near.as_ptr(),
                far.as_ptr(),
                out.as_mut_ptr().cast::<u8>(),
                n,
            )
        }
}
