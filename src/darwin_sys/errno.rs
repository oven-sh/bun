//! Error numbers.
//!
//! The image has one set of error numbers in all of bun's code: the ones of its C library, which are
//! the ones of Linux, and three that bun has on top (`bun_errno`). macOS numbers most errors
//! differently (`EAGAIN` is 35 there and 11 in the image) and has some that Linux does not have.
//! `generated::errno_names` has the number of the image for each name of macOS.

use crate::generated::errno_names::IN_THE_IMAGE;

/// The number after the greatest error number of macOS.
const COUNT: usize = 128;
/// What an error number of macOS that has no name here becomes: `EIO`.
const UNKNOWN: u8 = 5;

const TO_IMAGE: [u8; COUNT] = {
    let mut table = [UNKNOWN; COUNT];
    table[0] = 0;
    let mut index = 0;
    while index < IN_THE_IMAGE.len() {
        let (of_macos, of_image) = IN_THE_IMAGE[index];
        assert!(of_macos > 0 && (of_macos as usize) < COUNT && of_image > 0 && of_image < 256);
        // ELAST is the greatest number, under a second name.
        if table[of_macos as usize] == UNKNOWN {
            table[of_macos as usize] = of_image as u8;
        }
        index += 1;
    }
    table
};

/// The error number of the image for an error number of macOS.
#[inline]
pub const fn to_image(of_macos: i32) -> i32 {
    if of_macos < 0 || of_macos as usize >= COUNT {
        return UNKNOWN as i32;
    }
    TO_IMAGE[of_macos as usize] as i32
}

/// The error number of macOS for an error number of the image: what bun for macOS reports
/// (`error.errno`, `os.constants.errno`). A number that macOS has no name for is returned as it is.
pub const fn to_macos(of_image: i32) -> i32 {
    let mut index = 0;
    while index < IN_THE_IMAGE.len() {
        if IN_THE_IMAGE[index].1 == of_image {
            return IN_THE_IMAGE[index].0;
        }
        index += 1;
    }
    of_image
}
