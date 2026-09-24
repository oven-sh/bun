//! A bounded per-VM memo of resolver answers, valid while `bun_resolver::resolution_epoch` stands.

use core::ptr;

use bun_core::{String, WTFString, WTFStringImplStruct};

/// The inputs of a resolution besides the two strings.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Kind(u8);

impl Kind {
    #[inline]
    pub fn new(is_esm: bool, source_is_a_file_path: bool) -> Self {
        Self(u8::from(is_esm) | u8::from(source_is_a_file_path) << 1)
    }
}

struct Entry {
    specifier: WTFString,
    source: WTFString,
    path: WTFString,
}

#[derive(Default)]
struct Way {
    entry: Option<Entry>,
    /// The low half of the epoch. `ResolutionMemo::epoch_high` is the other half.
    epoch: u32,
    /// Compared before the strings of `entry`: those are most likely not in the CPU cache.
    tag: u16,
    kind: Kind,
    /// Not about `entry`: a tag of a pair last resolved without one, here to share the cache line.
    missed: u8,
}

/// Most recently used first.
#[derive(Default)]
#[repr(align(64))]
struct Bucket([Way; 2]);

const _: () = assert!(size_of::<Bucket>() == 64);

/// 64 KB.
const BUCKET_BITS: u32 = 10;

pub struct ResolutionMemo {
    buckets: Box<[Bucket]>,
    /// The high half of the epoch of every entry.
    epoch_high: u32,
    /// For `bun:internal-for-testing`.
    hits: u64,
}

impl Default for ResolutionMemo {
    fn default() -> Self {
        Self {
            buckets: core::iter::repeat_with(Bucket::default)
                .take(1 << BUCKET_BITS)
                .collect(),
            epoch_high: 0,
            hits: 0,
        }
    }
}

impl ResolutionMemo {
    pub fn hits(&self) -> u64 {
        self.hits
    }

    /// Entries keep the low half of their epoch, so none outlives a change of the high half.
    fn low_half(&mut self, epoch: u64) -> u32 {
        let high = (epoch >> 32) as u32;
        if high != self.epoch_high {
            self.buckets.fill_with(Bucket::default);
            self.epoch_high = high;
        }
        epoch as u32
    }

    /// The resolved path. `None` when either string is not WTF-backed: the key is the two impls.
    pub fn get(
        &mut self,
        specifier: &String,
        source: &String,
        kind: Kind,
        epoch: u64,
    ) -> Option<String> {
        let (specifier, source) = (specifier.as_wtf_impl()?, source.as_wtf_impl()?);
        let epoch = self.low_half(epoch);
        let (index, tag) = slot(specifier, source, kind);
        let Bucket(ways) = &mut self.buckets[index];
        let way = ways
            .iter()
            .position(|way| way.epoch == epoch && way.holds(tag, specifier, source, kind))?;
        if way != 0 {
            swap_entries(ways);
        }
        let path = String::retain_wtf_impl(ways[0].entry.as_ref()?.path.get());
        self.hits += 1;
        Some(path)
    }

    /// `epoch` is the one read before the resolver ran. The specifier has no `?query`.
    pub fn put(
        &mut self,
        specifier: &String,
        source: &String,
        kind: Kind,
        epoch: u64,
        path: &[u8],
    ) {
        let (Some(specifier), Some(source)) = (specifier.as_wtf_impl(), source.as_wtf_impl())
        else {
            return;
        };
        let epoch = self.low_half(epoch);
        let (index, tag) = slot(specifier, source, kind);
        let Bucket(ways) = &mut self.buckets[index];
        // An entry from an older epoch: the pair is a repeat, and most often the answer is the same.
        if let Some(way) = ways
            .iter()
            .position(|way| way.holds(tag, specifier, source, kind))
        {
            if way != 0 {
                swap_entries(ways);
            }
            if ways[0]
                .entry
                .as_ref()
                .is_some_and(|entry| is_ascii_path(&entry.path, path))
            {
                ways[0].epoch = epoch;
                return;
            }
        } else {
            // An entry starts at the second resolution of a pair, so a one-off evicts nothing.
            let missed = (tag as u8).max(1); // 0: the bucket saw nothing yet
            if ways.iter().all(|way| way.missed != missed) {
                ways[1].missed = ways[0].missed;
                ways[0].missed = missed;
                return;
            }
            // Over the less recently used.
            swap_entries(ways);
        }
        let path = String::clone_utf8(path);
        let Some(path) = path.as_wtf_impl() else {
            return;
        };
        ways[0].entry = Some(Entry {
            specifier: retain(specifier),
            source: retain(source),
            path: retain(path),
        });
        ways[0].epoch = epoch;
        ways[0].tag = tag;
        ways[0].kind = kind;
    }
}

impl Way {
    #[inline]
    fn holds(
        &self,
        tag: u16,
        specifier: &WTFStringImplStruct,
        source: &WTFStringImplStruct,
        kind: Kind,
    ) -> bool {
        self.tag == tag
            && self.kind == kind
            && self.entry.as_ref().is_some_and(|entry| {
                same_string(&entry.specifier, specifier) && same_string(&entry.source, source)
            })
    }
}

/// All but `missed`.
#[inline]
fn swap_entries(ways: &mut [Way; 2]) {
    let [a, b] = ways;
    core::mem::swap(&mut a.entry, &mut b.entry);
    core::mem::swap(&mut a.epoch, &mut b.epoch);
    core::mem::swap(&mut a.tag, &mut b.tag);
    core::mem::swap(&mut a.kind, &mut b.kind);
}

/// The same characters in the other width do not match, which only costs a resolution.
#[inline]
fn same_string(a: &WTFStringImplStruct, b: &WTFStringImplStruct) -> bool {
    ptr::eq(a, b) || (a.is_8bit() == b.is_8bit() && a.byte_slice() == b.byte_slice())
}

/// Whether `kept` is `path`. Only an ASCII path says yes: other characters are not the same bytes in UTF-8.
#[inline]
fn is_ascii_path(kept: &WTFStringImplStruct, path: &[u8]) -> bool {
    kept.is_8bit()
        && kept.byte_slice() == path
        && bun_core::strings::first_non_ascii(path).is_none()
}

/// The bucket of a key, and a tag that tells it from most other keys of that bucket.
#[inline]
fn slot(specifier: &WTFStringImplStruct, source: &WTFStringImplStruct, kind: Kind) -> (usize, u16) {
    // A `StringImpl` hash is 24 bits.
    let key = u64::from(specifier.hash()) << 32 | u64::from(source.hash()) << 8 | u64::from(kind.0);
    let mixed = key.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    // Both from the top: a bit of the product depends only on the key bits at and below it.
    (
        (mixed >> (u64::BITS - BUCKET_BITS)) as usize,
        (mixed >> (u64::BITS - BUCKET_BITS - u16::BITS)) as u16,
    )
}

#[inline]
fn retain(string: &WTFStringImplStruct) -> WTFString {
    // SAFETY: `string` is a live impl, which the new ref keeps alive.
    unsafe { WTFString::clone_from_raw(ptr::from_ref(string).cast_mut()) }
}
