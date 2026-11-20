//! TypeScript's `lib.*.d.ts` files, which declare `Array`, `Promise` and everything else that is
//! built in. They are in the executable, like typescript-go's (`internal/bundled`), so they are
//! always those of the version that the type checker is a port of.
//!
//! `scripts/update-typescript-libs.ts` writes `typescript_libs.bin`: the number of files as a
//! `u32`, as many records sorted by name, then the files. Each file is a zstd frame of its own, so
//! a thread decompresses only the file that it is about to parse. A long file without a dictionary
//! is several, for as many threads. Numbers are little-endian.

use bun_sema_driver::host::BundledLibs;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::OnceLock;

static BUNDLE: &[u8] = include_bytes!("typescript_libs.bin");

const NAME_LEN: usize = 39;
/// The length of the name, the name, where the frame starts in `BUNDLE`, its length, and its
/// dictionary.
const RECORD_LEN: usize = 1 + NAME_LEN + 4 + 4 + 4;

fn number(bytes: &[u8]) -> usize {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize
}

/// The frame of the file `name`, and the number of its dictionary.
fn frame(name: &[u8]) -> Option<(&'static [u8], usize)> {
    let records = &BUNDLE[4..][..number(BUNDLE) * RECORD_LEN];
    let records = records.as_chunks::<RECORD_LEN>().0;
    let found = records.binary_search_by(|record| record[1..][..record[0] as usize].cmp(name));
    let place = &records[found.ok()?][1 + NAME_LEN..];
    let frame = &BUNDLE[number(place)..][..number(&place[4..])];
    Some((frame, number(&place[8..])))
}

/// The files that are the dictionaries of the others, which repeat much of them. In a record they
/// are 1 and 2, and 0 is none, which is what they have themselves.
const DICTIONARIES: [&[u8]; 2] = [b"lib.es5.d.ts", b"lib.dom.d.ts"];

/// The text of one of `DICTIONARIES`. It is kept: a program that needs a file needs its dictionary
/// as well, but for a worker, which has no DOM.
fn dictionary(index: usize) -> Option<&'static [u8]> {
    static TEXTS: [OnceLock<Option<Vec<u8>>>; 2] = [const { OnceLock::new() }; 2];
    let text = || decompress_frames(frame(DICTIONARIES[index])?.0);
    TEXTS[index].get_or_init(text).as_deref()
}

fn decompress_frames(mut frames: &[u8]) -> Option<Vec<u8>> {
    let len = bun_zstd::decompressed_size(frames)?;
    let mut text = Vec::with_capacity(len);
    let (mut room, mut parts) = (&mut text.spare_capacity_mut()[..len], Vec::new());
    while !frames.is_empty() {
        let (first, rest) = bun_zstd::split_first_frame(frames)?;
        let (to, left) = room.split_at_mut_checked(bun_zstd::decompressed_size(first)?)?;
        parts.push(Guarded::new((first, to, false)));
        (frames, room) = (rest, left);
    }
    bun_sema::util::with_helpers(|in_parallel| {
        in_parallel(parts.len(), &|at| {
            let (frame, to, is_written) = &mut *parts[at].lock();
            bun_alloc::prefault(to);
            *is_written = bun_zstd::decompress_exact(to, frame);
        });
    });
    if !room.is_empty() || !parts.iter().all(|it| it.lock().2) {
        return None;
    }
    drop(parts);
    // SAFETY: the parts are all of the `len` bytes, and each has been written.
    unsafe { text.set_len(len) };
    Some(text)
}

fn read(name: &[u8]) -> Option<Cow<'static, [u8]>> {
    if let Some(index) = DICTIONARIES.iter().position(|it| *it == name) {
        return dictionary(index).map(Cow::Borrowed);
    }
    let (frame, of) = frame(name)?;
    let text = bun_zstd::decompress_alloc_with_prefix(frame, dictionary(of.checked_sub(1)?)?);
    text.ok().map(Cow::Owned)
}

pub(crate) const BUNDLED: BundledLibs = BundledLibs {
    has: |name| frame(name).is_some(),
    read,
};

/// `process.versions.typescript`
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__typescript_version() -> *const core::ffi::c_char {
    bun_sema_driver::TYPESCRIPT_VERSION.as_ptr()
}
