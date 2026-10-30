//! `Bun.semver`: `SemverObject.bind.ts`.

use core::cmp::Ordering;

use bun_core::strings;
use bun_jsc::bindgen::{self, JsHeap};
use bun_semver::{SlicedString, Version, query};

use crate::generated_bindgen::semver_object::SatisfiesOptions;

pub(crate) fn order<'a>(
    heap: &JsHeap<'a>,
    left: &'a [u8],
    right: &'a [u8],
) -> bindgen::Result<'a, i32> {
    if !strings::is_all_ascii(left) || !strings::is_all_ascii(right) {
        return Ok(0);
    }

    let left_result = Version::parse(SlicedString::init(left, left));
    let right_result = Version::parse(SlicedString::init(right, right));

    for (result, input) in [(&left_result, left), (&right_result, right)] {
        if !result.valid {
            return Err(heap.error(format_args!("Invalid SemVer: {}\n", bstr::BStr::new(input))));
        }
    }

    let left_version = left_result.version.max();
    let right_version = right_result.version.max();

    Ok(
        match left_version.order_without_build(right_version, left, right) {
            Ordering::Equal => 0,
            Ordering::Greater => 1,
            Ordering::Less => -1,
        },
    )
}

pub(crate) fn satisfies<'a>(
    version: &'a [u8],
    range: &'a [u8],
    options: &SatisfiesOptions,
) -> bindgen::Result<'a, bool> {
    if !strings::is_all_ascii(version) || !strings::is_all_ascii(range) {
        return Ok(false);
    }

    let Some(parsed_version) = Version::parse_exact(SlicedString::init(version, version)) else {
        return Ok(false);
    };

    // Both halves of node-semver's `includePrerelease`: the range parses with a `-0` floor
    // (`1.x` is `>=1.0.0-0 <2.0.0-0`), and a prerelease only has to satisfy the comparators.
    let sliced = SlicedString::init(range, range);
    let group = if options.include_prerelease {
        query::parse_including_prerelease(range, sliced)?
    } else {
        query::parse(range, sliced)?
    };

    if let Some(exact_version) = group.get_exact_version() {
        return Ok(parsed_version.eql(exact_version));
    }

    Ok(if options.include_prerelease {
        group.satisfies_including_prerelease(parsed_version, range, version)
    } else {
        group.satisfies(parsed_version, range, version)
    })
}

/// `bun:internal-for-testing`: `Group::intersects` on two range strings.
pub(crate) fn intersects<'a>(left: &'a [u8], right: &'a [u8]) -> bindgen::Result<'a, bool> {
    let left_group = query::parse(left, SlicedString::init(left, left))?;
    let right_group = query::parse(right, SlicedString::init(right, right))?;
    Ok(left_group.intersects(left, &right_group, right))
}
