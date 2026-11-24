use core::time::Duration;
use std::io::Write as _;

use bstr::BStr;
use bun_core::write_pretty;
use bun_sema_driver::format::plural;

const MIN_LINES_FOR_RATE: u64 = 1_000;
const MIN_TIME_WIDTH: usize = "[10.00s]".len();
const LABEL_WIDTH: usize = "compile".len();
const LABEL_END: usize = 1 + MIN_TIME_WIDTH + 1 + LABEL_WIDTH;

#[derive(Copy, Clone)]
pub struct ExecutableSize {
    pub bytes: u64,
    pub trimmed_bytes: Option<u64>,
}

pub struct BuildRows<'a> {
    pub bundle_time: Duration,
    pub check_time: Duration,
    pub compile_time: Duration,
    pub module_count: u64,
    pub line_count: u64,
    pub untyped_file_count: u64,
    pub outfile: &'a [u8],
    pub executable: Option<ExecutableSize>,
    pub build_id: Option<&'a [u8]>,
}

fn format_time(time: Duration) -> String {
    let milliseconds = time.as_millis();
    if milliseconds < 1_000 {
        return format!("[{milliseconds}ms]");
    }
    let hundredths = (milliseconds + 5) / 10;
    format!("[{}.{:02}s]", hundredths / 100, hundredths % 100)
}

fn format_tenths(tenths: u64, unit: &str) -> String {
    format!("{}.{}{unit}", tenths / 10, tenths % 10)
}

fn format_megabytes(bytes: u64) -> String {
    format_tenths(bytes.saturating_add(50_000) / 100_000, " MB")
}

pub fn format_executable_size(size: ExecutableSize) -> String {
    let bytes = format_megabytes(size.bytes);
    match size.trimmed_bytes {
        Some(trimmed_bytes) => format!("{bytes}  ({} trimmed)", format_megabytes(trimmed_bytes)),
        None => bytes,
    }
}

pub fn format_rate(line_count: u64, time: Duration) -> Option<String> {
    if line_count < MIN_LINES_FOR_RATE || time.is_zero() {
        return None;
    }
    let per_second = u128::from(line_count) * 1_000_000_000 / time.as_nanos();
    let per_second = u64::try_from(per_second).unwrap_or(u64::MAX);
    let number = match per_second {
        0..1_000 => per_second.to_string(),
        1_000..999_950 => format_tenths((per_second + 50) / 100, "k"),
        _ => format_tenths(per_second.saturating_add(50_000) / 100_000, "M"),
    };
    Some(number + " lines/s")
}

pub fn format_line_count(line_count: u64) -> String {
    plural(line_count as usize, b"line", b"lines").to_string()
}

pub fn format_untyped_files(untyped_file_count: u64) -> Option<String> {
    let files = plural(untyped_file_count as usize, b"file", b"files");
    (untyped_file_count > 0).then(|| format!("{files} compiled without types"))
}

fn write_spaces(out: &mut Vec<u8>, count: usize) {
    out.resize(out.len() + count, b' ');
}

fn write_dimmed(out: &mut Vec<u8>, has_colors: bool, text: &[u8]) {
    let _ = write_pretty!(out, has_colors, "  <d>{}<r>", BStr::new(text));
}

pub fn write_build_rows(rows: &BuildRows<'_>, has_colors: bool, out: &mut Vec<u8>) {
    let [bundle, check, compile] =
        [rows.bundle_time, rows.check_time, rows.compile_time].map(format_time);
    let widths = [&bundle, &check, &compile].map(|time| time.len());
    let time_width = widths.into_iter().fold(MIN_TIME_WIDTH, usize::max) + 1;
    let begin_row = |out: &mut Vec<u8>, time: &str, label: &str| {
        write_spaces(out, time_width - time.len());
        let number = &time[1..time.len() - 1];
        let _ = write_pretty!(out, has_colors, "<r><d>[<b>{}<r><d>]<r> ", number);
        write_spaces(out, LABEL_WIDTH - label.len());
        let _ = write_pretty!(out, has_colors, "<green>{}<r>  ", label);
    };

    begin_row(out, &bundle, "bundle");
    out.extend_from_slice(&plural(rows.module_count as usize, b"module", b"modules"));
    out.push(b'\n');

    begin_row(out, &check, "check");
    out.extend_from_slice(format_line_count(rows.line_count).as_bytes());
    if let Some(untyped_files) = format_untyped_files(rows.untyped_file_count) {
        write_dimmed(out, has_colors, untyped_files.as_bytes());
    }
    out.push(b'\n');

    begin_row(out, &compile, "compile");
    let _ = write_pretty!(out, has_colors, "<b><blue>{}<r>", BStr::new(rows.outfile));
    let whole_build = rows.bundle_time + rows.check_time + rows.compile_time;
    let size = rows.executable.map(format_executable_size);
    let details: Vec<String> = [size, format_rate(rows.line_count, whole_build)]
        .into_iter()
        .flatten()
        .collect();
    if !details.is_empty() {
        write_dimmed(out, has_colors, details.join("  ").as_bytes());
    }
    out.push(b'\n');

    if let Some(build_id) = rows.build_id {
        let label = "build id";
        write_spaces(out, time_width + 1 + LABEL_WIDTH - label.len());
        let _ = write_pretty!(out, has_colors, "<green>{}<r>", label);
        write_dimmed(out, has_colors, build_id);
        out.push(b'\n');
    }
}

pub fn write_note_row(label: &str, lines: &[Vec<u8>], has_colors: bool, out: &mut Vec<u8>) {
    for (index, line) in lines.iter().enumerate() {
        if index == 0 {
            write_spaces(out, LABEL_END - label.len());
            let _ = write_pretty!(out, has_colors, "<green>{}<r>", label);
        } else {
            write_spaces(out, LABEL_END);
        }
        write_dimmed(out, has_colors, line);
        out.push(b'\n');
    }
}

#[cfg(test)]
#[path = "build_rows/tests.rs"]
mod tests;
