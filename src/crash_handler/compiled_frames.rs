use core::ffi::c_void;

use bun_base64::VLQ;
use bun_core::strings;
use bun_removable_features::Feature;

use crate::build_id::{build_id, write_hexadecimal};

unsafe extern "C" {
    safe fn Bun__AOT__offsetInCode(address: *const c_void) -> i64;
    safe fn Bun__AOT__frameAtReturnAddress(return_address: *const c_void) -> i64;
    fn Bun__AOT__describeAddresses(
        addresses: *const usize,
        count: usize,
        buffer: *mut u8,
        capacity: usize,
    ) -> usize;
    safe fn Bun__AOT__addressOfOffsetInCode(offset: usize) -> usize;
}

const SECONDS_TO_DESCRIBE_FRAMES: u32 = 2;
const OBJECT_NAME: &[u8] = b"aot";
const ID_DIGITS_IN_REPORT: usize = 16;

/// The start of a build ID, as a report has it.
pub type ShortBuildId = [u8; ID_DIGITS_IN_REPORT];

fn own_short_build_id() -> Option<ShortBuildId> {
    let mut digits = [0u8; ID_DIGITS_IN_REPORT];
    digits.copy_from_slice(&write_hexadecimal(&build_id()?)[..ID_DIGITS_IN_REPORT]);
    Some(digits)
}

/// The object of a frame in compiled code, as the link of a crash report names it.
pub(crate) fn object_name(names_build: bool) -> Box<[u8]> {
    match own_short_build_id().filter(|_| names_build) {
        Some(id) => [OBJECT_NAME, &id[..]].concat().into_boxed_slice(),
        None => Box::from(OBJECT_NAME),
    }
}

pub(crate) fn offset_in_code(address: usize) -> Option<i32> {
    i32::try_from(Bun__AOT__offsetInCode(address as *const c_void))
        .ok()
        .filter(|offset| *offset >= 0)
}

pub(crate) fn frame_at_return_address(
    return_address: usize,
) -> Option<bun_core::debug::CompiledFrame> {
    bun_core::debug::CompiledFrame::decode(Bun__AOT__frameAtReturnAddress(
        return_address as *const c_void,
    ))
}

fn describe(addresses: &[usize], buffer: &mut [u8]) -> usize {
    // SAFETY: both are initialized for the lengths that are passed, and no more than the buffer's length is written.
    unsafe {
        Bun__AOT__describeAddresses(
            addresses.as_ptr(),
            addresses.len(),
            buffer.as_mut_ptr(),
            buffer.len(),
        )
    }
}

#[cfg(unix)]
fn describe_or_end_process(addresses: &[usize], buffer: &mut [u8]) -> usize {
    // SAFETY: `alarm` has no preconditions. The handlers are reset, so SIGALRM ends the process.
    unsafe { libc::alarm(SECONDS_TO_DESCRIBE_FRAMES) };
    let length = describe(addresses, buffer);
    // SAFETY: as above.
    unsafe { libc::alarm(0) };
    length
}

#[cfg(windows)]
fn describe_or_end_process(addresses: &[usize], buffer: &mut [u8]) -> usize {
    use core::sync::atomic::{AtomicBool, Ordering};

    static IS_DONE: AtomicBool = AtomicBool::new(false);
    unsafe extern "system" {
        safe fn GetCurrentProcess() -> *mut c_void;
        safe fn TerminateProcess(process: *mut c_void, exit_code: u32) -> i32;
    }
    let _ = std::thread::Builder::new().spawn(|| {
        std::thread::sleep(core::time::Duration::from_secs(u64::from(
            SECONDS_TO_DESCRIBE_FRAMES,
        )));
        if !IS_DONE.load(Ordering::Acquire) {
            TerminateProcess(GetCurrentProcess(), 3);
        }
    });
    let length = describe(addresses, buffer);
    IS_DONE.store(true, Ordering::Release);
    length
}

/// For a process that is crashing: the tables that are read may be what is broken.
pub(crate) fn write_frames_on_stack(addresses: &[usize], write: &mut dyn FnMut(&[u8])) {
    if !addresses
        .iter()
        .any(|&address| offset_in_code(address).is_some())
    {
        return;
    }
    let mut frames = [0u8; 4096];
    let length = describe_or_end_process(addresses, &mut frames);
    if length > 0 {
        write(b"Compiled JavaScript on the stack:\n");
        write(&frames[..length]);
        write(b"\n");
    }
}

pub enum DecodedReport {
    /// The compiled functions that the addresses in the report lie in, one line each.
    Frames(Vec<u8>),
    NoCompiledFrames,
    /// The offsets mean other functions in this executable. `of_report` is `None` where the report names no build.
    OtherBuild {
        of_report: Option<ShortBuildId>,
        of_executable: ShortBuildId,
    },
}

fn prefix_of_object(name_length: usize) -> Vec<u8> {
    [
        VLQ::encode(1).slice(),
        VLQ::encode(name_length as i32).slice(),
    ]
    .concat()
}

pub fn report_compiled_frames(report: &[u8]) -> DecodedReport {
    let prefix = prefix_of_object(OBJECT_NAME.len());
    let prefix_with_build = prefix_of_object(OBJECT_NAME.len() + ID_DIGITS_IN_REPORT);
    let mut of_report: Option<ShortBuildId> = None;
    let mut addresses: Vec<usize> = Vec::new();
    let mut at = 0;
    while let Some(found) = strings::index_of(&report[at..], OBJECT_NAME) {
        let name = at + found;
        at = name + OBJECT_NAME.len();
        if report[..name].ends_with(&prefix_with_build) {
            let Some(digits) = report.get(at..at + ID_DIGITS_IN_REPORT) else {
                break;
            };
            of_report = of_report.or_else(|| digits.try_into().ok());
            at += ID_DIGITS_IN_REPORT;
        } else if !report[..name].ends_with(&prefix) {
            continue;
        }
        let offset = bun_base64::vlq::decode(report, at);
        if offset.start == at {
            continue;
        }
        at = offset.start;
        if let Ok(offset) = usize::try_from(offset.value) {
            addresses.push(Bun__AOT__addressOfOffsetInCode(offset + 1));
        }
    }
    if addresses.is_empty() {
        return DecodedReport::NoCompiledFrames;
    }
    if let Some(of_executable) = own_short_build_id().filter(|own| of_report != Some(*own)) {
        return DecodedReport::OtherBuild {
            of_report,
            of_executable,
        };
    }
    let mut frames = vec![0u8; 1024 * addresses.len()];
    let length = describe(&addresses, &mut frames);
    frames.truncate(length);
    match frames.is_empty() {
        true => DecodedReport::NoCompiledFrames,
        false => DecodedReport::Frames(frames),
    }
}

/// `pc`: where the processor tried to run an instruction. The addresses of a removed range are free for later mappings, so
/// a fault on data there says nothing about the feature.
pub(crate) fn removed_feature_entered(pc: usize) -> Option<Feature> {
    // On ELF the compiled program can be mapped where the largest removed range was.
    if offset_in_code(pc).is_some() {
        return None;
    }
    bun_removable_features::removed_feature_at(pc)
}

#[cfg(test)]
mod tests {
    use super::removed_feature_entered;

    /// The engine's, as in an executable without compiled code.
    #[unsafe(no_mangle)]
    extern "C" fn Bun__AOT__offsetInCode(_address: *const core::ffi::c_void) -> i64 {
        -1
    }

    #[test]
    fn untrimmed_executable_reaches_no_removed_feature() {
        let local_function = removed_feature_entered as *const () as usize;
        assert!(removed_feature_entered(0).is_none());
        assert!(removed_feature_entered(usize::MAX).is_none());
        assert!(removed_feature_entered(local_function).is_none());
    }
}
