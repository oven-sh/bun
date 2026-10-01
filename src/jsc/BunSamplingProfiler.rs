use bun_core::Output;
use bun_core::String as BunString;
use bun_paths::AutoAbsPathChecked;
use bun_sys::{self as sys, Fd};

use crate::JSGlobalObject;

unsafe extern "C" {
    /// Empty unless `startSamplingProfiler()` in `bun:jsc` was given a directory. Empty from then on.
    safe fn Bun__takeSamplingProfilerReportPath(global: &JSGlobalObject) -> BunString;
    safe fn Bun__generateSamplingProfilerReport(global: &JSGlobalObject) -> BunString;
}

pub(crate) fn write_report(global: &JSGlobalObject) {
    let path_string = Bun__takeSamplingProfilerReportPath(global);
    if path_string.is_empty() {
        return;
    }
    let path_slice = path_string.to_utf8();
    let report_string = Bun__generateSamplingProfilerReport(global);
    let report_slice = report_string.to_utf8();

    // The directory is unbounded input, so use the length-checked variant.
    let mut path_buf = AutoAbsPathChecked::init_top_level_dir();
    let result = match path_buf.join(&[path_slice.slice()]) {
        Err(_) => Err(sys::Error::from_code(sys::E::ENAMETOOLONG, sys::Tag::open)),
        Ok(()) => {
            #[cfg(windows)]
            {
                let mut path_buf_os = bun_paths::os_path_buffer_pool::get();
                let path_os: &bun_core::WStr = bun_core::strings::convert_utf8_to_utf16_in_buffer_z(
                    &mut path_buf_os,
                    path_buf.slice_z().as_bytes(),
                );
                sys::File::write_file_os_path(Fd::cwd(), path_os, report_slice.slice())
            }
            #[cfg(not(windows))]
            sys::File::write_file(Fd::cwd(), path_buf.slice_z(), report_slice.slice())
        }
    };
    if let Err(err) = result {
        Output::err(
            err,
            "Failed to write sampling profiler report to {}",
            (bun_core::fmt::quote(path_slice.slice()),),
        );
    }
}
