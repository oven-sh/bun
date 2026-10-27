//! `filter_enc.c`: the strength of the loop filter.

use super::Encoder;

/// `VP8FilterStrengthFromDelta`: the filtering strength it takes to smooth a step of `delta`, at sharpness 0.
pub(super) fn strength_from_delta(delta: i32) -> i32 {
    delta.min(63)
}

/// `VP8AdjustFilterStrength`: raises the strength of the segments where blocky macroblocks were seen.
pub(super) fn adjust_strength(enc: &mut Encoder<'_>) {
    let mut max_level = 0;
    for dqm in &mut enc.dqm {
        // The shift accounts for the scaling of the inverse WHT.
        let delta = (dqm.max_edge * i32::from(dqm.y2.q[0][1])) >> 3;
        dqm.fstrength = dqm.fstrength.max(strength_from_delta(delta));
        max_level = max_level.max(dqm.fstrength);
    }
    enc.filter_level = max_level;
}
