use core::mem::offset_of;
use core::ptr;
use core::slice;

use crate::{Feature, Removal};

#[repr(C)]
pub struct RemovableFeatureState {
    pub magic: [u8; 8],
    pub is_trimmed: u32,
    pub removed_range_count: u32,
    pub removed_ranges_offset: i64,
    pub removal: [u8; Feature::INDEX_LIMIT],
}

impl RemovableFeatureState {
    pub const MAGIC: [u8; 8] = *b"BUNFEAT\0";
}

#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct RemovedRange {
    pub start: i64,
    pub size: u32,
    pub feature: u16,
    pub reserved: u16,
}

pub const MAX_REMOVED_RANGES: u32 = 32768;

const REMOVED_RANGE_ALIGNMENT: i64 = align_of::<RemovedRange>() as i64;

const _: () = assert!(
    size_of::<RemovableFeatureState>() == 536
        && align_of::<RemovableFeatureState>() == 8
        && offset_of!(RemovableFeatureState, removal) == 24
        && size_of::<RemovedRange>() == 16
        && align_of::<RemovedRange>() == 8
);

#[cfg(all(not(miri), target_vendor = "apple"))]
core::arch::global_asm!(
    ".section __TEXT,__bun_features",
    ".globl _Bun__removableFeatureState",
    ".p2align 3",
    "_Bun__removableFeatureState:",
    ".ascii \"BUNFEAT\\0\"",
    ".zero 528",
    ".text",
);

#[cfg(all(not(miri), windows))]
core::arch::global_asm!(
    ".section .bunfeat,\"dr\"",
    ".globl Bun__removableFeatureState",
    ".p2align 3",
    "Bun__removableFeatureState:",
    ".ascii \"BUNFEAT\\0\"",
    ".zero 528",
    ".text",
);

#[cfg(not(any(miri, target_vendor = "apple", windows)))]
core::arch::global_asm!(
    ".section .bun_features,\"a\",@progbits",
    ".globl Bun__removableFeatureState",
    ".type Bun__removableFeatureState,@object",
    ".size Bun__removableFeatureState, 536",
    ".p2align 3",
    "Bun__removableFeatureState:",
    ".ascii \"BUNFEAT\\0\"",
    ".zero 528",
    ".text",
);

#[cfg(not(miri))]
unsafe extern "C" {
    #[link_name = "Bun__removableFeatureState"]
    static STATE: RemovableFeatureState;
}

#[cfg(not(miri))]
#[inline(always)]
fn state() -> &'static RemovableFeatureState {
    // SAFETY: the symbol is defined in this file, has this layout, and nothing writes it after
    // the executable is built.
    unsafe { &STATE }
}

#[cfg(miri)]
#[allow(non_upper_case_globals)]
#[unsafe(no_mangle)]
static Bun__removableFeatureState: RemovableFeatureState = RemovableFeatureState {
    magic: RemovableFeatureState::MAGIC,
    is_trimmed: 0,
    removed_range_count: 0,
    removed_ranges_offset: 0,
    removal: [0; Feature::INDEX_LIMIT],
};

#[cfg(miri)]
#[inline(always)]
fn state() -> &'static RemovableFeatureState {
    &Bun__removableFeatureState
}

#[inline(always)]
pub(crate) fn is_removed_index(index: u16) -> bool {
    state().removal[index as usize] != Removal::Present as u8
}

#[inline(always)]
pub fn is_removed(feature: Feature) -> bool {
    is_removed_index(feature.index())
}

const fn removal_from_byte(byte: u8) -> Removal {
    if byte == Removal::Present as u8 {
        Removal::Present
    } else if byte == Removal::Requested as u8 {
        Removal::Requested
    } else {
        Removal::Unused
    }
}

pub fn removal_of(feature: Feature) -> Removal {
    removal_from_byte(state().removal[feature.index() as usize])
}

pub fn is_trimmed() -> bool {
    state().is_trimmed != 0
}

fn has_removed_range_list(state: &RemovableFeatureState) -> bool {
    (1..=MAX_REMOVED_RANGES).contains(&state.removed_range_count)
        && state.removed_ranges_offset % REMOVED_RANGE_ALIGNMENT == 0
}

pub fn removed_feature_at(address: usize) -> Option<Feature> {
    let state = state();
    if !has_removed_range_list(state) {
        return None;
    }
    let count = state.removed_range_count as usize;
    let base = ptr::from_ref(state).addr();
    let list_address = base.wrapping_add_signed(state.removed_ranges_offset as isize);
    let first = ptr::with_exposed_provenance::<RemovedRange>(list_address);
    // SAFETY: `apply` wrote `count` records there, in read-only memory of this image.
    let ranges = unsafe { slice::from_raw_parts(first, count) };
    let offset = (address as i64).wrapping_sub(base as i64);
    find_removed_range(ranges, offset).and_then(Feature::from_index)
}

pub fn find_removed_range(ranges: &[RemovedRange], offset: i64) -> Option<u16> {
    let end = ranges.partition_point(|range| range.start <= offset);
    let range = ranges[..end].last()?;
    (offset.abs_diff(range.start) < u64::from(range.size)).then_some(range.feature)
}

#[cold]
#[inline(never)]
pub fn abort_for_removed_feature(feature: Feature) -> ! {
    unsafe extern "C" {
        fn Bun__abortForRemovedFeature(feature: u16) -> !;
    }
    // SAFETY: the function takes any feature index and has no other precondition.
    unsafe { Bun__abortForRemovedFeature(feature.index()) }
}

#[cfg(test)]
#[unsafe(no_mangle)]
extern "C" fn Bun__abortForRemovedFeature(feature: u16) -> ! {
    panic!("removed feature {feature}");
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn range(start: i64, size: u32, feature: u16) -> RemovedRange {
        RemovedRange {
            start,
            size,
            feature,
            reserved: 0,
        }
    }

    const RANGES: [RemovedRange; 4] = [
        range(-64, 16, 1),
        range(100, 10, 2),
        range(110, 6, 3),
        range(200, 1, 4),
    ];

    const fn state_with_list(
        is_trimmed: u32,
        removed_range_count: u32,
        removed_ranges_offset: i64,
    ) -> RemovableFeatureState {
        RemovableFeatureState {
            magic: RemovableFeatureState::MAGIC,
            is_trimmed,
            removed_range_count,
            removed_ranges_offset,
            removal: [0; Feature::INDEX_LIMIT],
        }
    }

    fn local_function() {}

    #[test]
    fn unknown_removal_byte_is_unused() {
        assert_eq!(removal_from_byte(0), Removal::Present);
        assert_eq!(removal_from_byte(1), Removal::Unused);
        assert_eq!(removal_from_byte(2), Removal::Requested);
        assert_eq!(removal_from_byte(3), Removal::Unused);
        assert_eq!(removal_from_byte(255), Removal::Unused);
    }

    #[test]
    fn accepts_valid_list_header() {
        assert!(has_removed_range_list(&state_with_list(1, 1, 536)));
        assert!(has_removed_range_list(&state_with_list(
            1,
            MAX_REMOVED_RANGES,
            536
        )));
        assert!(has_removed_range_list(&state_with_list(1, 1, -8)));
    }

    #[test]
    fn accepts_list_of_executable_without_tools() {
        assert!(has_removed_range_list(&state_with_list(0, 1, 536)));
    }

    #[test]
    fn rejects_whole_executable() {
        assert!(!has_removed_range_list(&state_with_list(0, 0, 0)));
    }

    #[test]
    fn rejects_range_count_outside_limit() {
        assert!(!has_removed_range_list(&state_with_list(1, 0, 536)));
        assert!(!has_removed_range_list(&state_with_list(
            1,
            MAX_REMOVED_RANGES + 1,
            536
        )));
        assert!(!has_removed_range_list(&state_with_list(1, u32::MAX, 536)));
    }

    #[test]
    fn rejects_misaligned_list_offset() {
        assert!(!has_removed_range_list(&state_with_list(1, 1, 4)));
        assert!(!has_removed_range_list(&state_with_list(1, 1, -4)));
        assert!(!has_removed_range_list(&state_with_list(1, 1, 537)));
    }

    #[test]
    fn test_binary_is_untrimmed() {
        assert_eq!(state().magic, RemovableFeatureState::MAGIC);
        assert!(!is_trimmed());
        for &feature in Feature::ALL {
            assert!(!is_removed(feature));
            assert_eq!(removal_of(feature), Removal::Present);
        }
    }

    #[test]
    fn untrimmed_lookup_finds_nothing() {
        assert_eq!(removed_feature_at(0), None);
        assert_eq!(removed_feature_at(usize::MAX), None);
        let local_address = (local_function as fn() as *const ()).addr();
        assert_eq!(removed_feature_at(local_address), None);
    }

    #[test]
    fn finds_boundary_bytes() {
        assert_eq!(find_removed_range(&RANGES, 100), Some(2));
        assert_eq!(find_removed_range(&RANGES, 109), Some(2));
        assert_eq!(find_removed_range(&RANGES, 200), Some(4));
    }

    #[test]
    fn finds_adjacent_ranges() {
        assert_eq!(find_removed_range(&RANGES, 110), Some(3));
        assert_eq!(find_removed_range(&RANGES, 115), Some(3));
    }

    #[test]
    fn finds_range_below_state() {
        assert_eq!(find_removed_range(&RANGES, -64), Some(1));
        assert_eq!(find_removed_range(&RANGES, -49), Some(1));
    }

    #[test]
    fn misses_one_past_end() {
        assert_eq!(find_removed_range(&RANGES, -48), None);
        assert_eq!(find_removed_range(&RANGES, 116), None);
        assert_eq!(find_removed_range(&RANGES, 201), None);
    }

    #[test]
    fn misses_gap() {
        assert_eq!(find_removed_range(&RANGES, 0), None);
        assert_eq!(find_removed_range(&RANGES, 99), None);
        assert_eq!(find_removed_range(&RANGES, 150), None);
    }

    #[test]
    fn misses_before_first() {
        assert_eq!(find_removed_range(&RANGES, -65), None);
        assert_eq!(find_removed_range(&RANGES, i64::MIN), None);
    }

    #[test]
    fn misses_after_last() {
        assert_eq!(find_removed_range(&RANGES, 1000), None);
        assert_eq!(find_removed_range(&RANGES, i64::MAX), None);
    }

    #[test]
    fn misses_empty_list() {
        assert_eq!(find_removed_range(&[], 0), None);
    }

    #[test]
    fn misses_empty_range() {
        assert_eq!(find_removed_range(&[range(8, 0, 1)], 8), None);
    }

    #[test]
    fn distance_does_not_overflow() {
        let lowest = [range(i64::MIN, 1, 1)];
        assert_eq!(find_removed_range(&lowest, i64::MIN), Some(1));
        assert_eq!(find_removed_range(&lowest, i64::MAX), None);
        let largest = [range(0, u32::MAX, 2)];
        let end = i64::from(u32::MAX);
        assert_eq!(find_removed_range(&largest, end - 1), Some(2));
        assert_eq!(find_removed_range(&largest, end), None);
    }
}
