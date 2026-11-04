//! The name of an executable that holds a compiled program.

use std::borrow::Cow;

use crate::builtins::Image;
use crate::identity::find_rest_of_gnu_build_id;
use crate::image::{KnownSection, read_bytes_at};
use crate::section::find_known_section;
use bun_sha_hmac::sha::SHA256;

pub const SIZE: usize = 16;
const OFFSET_IN_SECTION: usize = 16;
const CHUNK_SIZE: usize = 4 << 20;

/// The same bytes give the same name, however many threads there are.
pub fn compute(payload: &[u8]) -> [u8; SIZE] {
    compute_of_parts(&[payload])
}

/// The chunks of the payload that `parts` are, one behind the other. A chunk that lies in more than one part is copied.
fn chunks_of_parts<'a>(parts: &[&'a [u8]]) -> Vec<Cow<'a, [u8]>> {
    let mut chunks = Vec::new();
    let mut last: Cow<'a, [u8]> = Cow::default();
    for &part in parts {
        let missing = match last.len() {
            0 => 0,
            length => CHUNK_SIZE - length,
        };
        let (first, others) = part.split_at(missing.min(part.len()));
        if !first.is_empty() {
            last.to_mut().extend_from_slice(first);
        }
        if last.len() == CHUNK_SIZE {
            chunks.push(core::mem::take(&mut last));
        }
        if !others.is_empty() {
            let whole = others.chunks_exact(CHUNK_SIZE);
            last = Cow::Borrowed(whole.remainder());
            chunks.extend(whole.map(Cow::Borrowed));
        }
    }
    if !last.is_empty() {
        chunks.push(last);
    }
    chunks
}

/// The name of the payload that `parts` are, one behind the other. It does not tell where a part ends.
pub fn compute_of_parts(parts: &[&[u8]]) -> [u8; SIZE] {
    let chunks = chunks_of_parts(parts);
    let mut digests = vec![[0u8; 32]; chunks.len()];
    let threads = usize::from(bun_core::get_thread_count());
    let chunks_per_thread = chunks.len().div_ceil(threads).max(1);
    let shares = chunks
        .chunks(chunks_per_thread)
        .zip(digests.chunks_mut(chunks_per_thread));
    bun_core::for_each_in_parallel(shares, |(chunks, digests)| {
        for (chunk, digest) in chunks.iter().zip(digests) {
            SHA256::hash(chunk, digest);
        }
    });
    let mut digest = [0u8; 32];
    SHA256::hash(digests.as_flattened(), &mut digest);
    let mut id = [0u8; SIZE];
    id.copy_from_slice(&digest[..SIZE]);
    id
}

/// False if `template` has no place for a name.
pub fn write(template: &mut [u8], id: &[u8; SIZE]) -> bool {
    let len = template.len();
    let mut read = |offset: usize, out: &mut [u8]| read_bytes_at(template, offset, out);
    let image = &mut Image {
        len,
        read: &mut read,
    };
    let Ok(location) = find_known_section(image, KnownSection::BuildId) else {
        return false;
    };
    let place = usize::try_from(location.file_offset)
        .ok()
        .map(|start| start + OFFSET_IN_SECTION)
        .and_then(|start| template.get_mut(start..start + SIZE));
    match place {
        Some(place) => place.copy_from_slice(id),
        None => return false,
    }
    write_into_gnu_build_id(template, id);
    true
}

/// perf, gdb and systemd-coredump tell files apart by the GNU build ID, and every executable would have its template's.
fn write_into_gnu_build_id(template: &mut [u8], id: &[u8; SIZE]) {
    let len = template.len();
    let mut read = |offset: usize, out: &mut [u8]| read_bytes_at(template, offset, out);
    let rest = find_rest_of_gnu_build_id(&mut Image {
        len,
        read: &mut read,
    });
    if let Some(rest) = rest.and_then(|rest| template.get_mut(rest)) {
        let length = rest.len().min(SIZE);
        rest[..length].copy_from_slice(&id[..length]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_follows_the_bytes_alone() {
        let payload: Vec<u8> = (0..CHUNK_SIZE * 2 + 5)
            .map(|index| (index / 7) as u8)
            .collect();
        let mut changed = payload.clone();
        *changed.last_mut().unwrap() ^= 1;
        assert_eq!(compute(&payload), compute(&payload));
        assert_ne!(compute(&payload), compute(&changed));
        assert_ne!(compute(&payload), compute(&payload[..payload.len() - 1]));
        assert_ne!(compute(b""), [0; SIZE]);
    }

    #[test]
    fn name_is_made_of_the_digests_of_the_chunks() {
        let payload: Vec<u8> = (0..CHUNK_SIZE + 3)
            .map(|index| (index % 251) as u8)
            .collect();
        let mut digests = [[0u8; 32]; 2];
        SHA256::hash(&payload[..CHUNK_SIZE], &mut digests[0]);
        SHA256::hash(&payload[CHUNK_SIZE..], &mut digests[1]);
        let mut digest = [0u8; 32];
        SHA256::hash(digests.as_flattened(), &mut digest);
        assert_eq!(compute(&payload), digest[..SIZE]);
    }

    #[test]
    fn name_does_not_tell_where_a_part_ends() {
        let payload: Vec<u8> = (0..CHUNK_SIZE * 3 + 5)
            .map(|index| (index / 7) as u8)
            .collect();
        let name = compute(&payload);
        for [first, second] in [
            [0, 0],
            [10, 20],
            [1, CHUNK_SIZE],
            [CHUNK_SIZE - 1, CHUNK_SIZE + 1],
            [CHUNK_SIZE, 2 * CHUNK_SIZE],
            [CHUNK_SIZE + 3, 3 * CHUNK_SIZE + 4],
            [payload.len(), payload.len()],
        ] {
            let parts = [
                &payload[..first],
                &payload[first..second],
                &payload[second..],
            ];
            assert_eq!(compute_of_parts(&parts), name, "{first} {second}");
        }
        assert_eq!(compute_of_parts(&[]), compute(b""));
    }

    #[test]
    fn file_that_is_no_executable_takes_no_name() {
        assert!(!write(&mut [0u8; 64], &[1; SIZE]));
        assert!(!write(&mut [], &[1; SIZE]));
    }
}
