use bstr::BStr;
use bun_core::strings;

use crate::{Registration, Title};

/// The marker line and the job's line. The caller refuses `'` and `%` in the paths.
pub fn entry(job: &Registration<'_>) -> String {
    let (title, schedule) = (&job.title, &job.schedule);
    // Debian's cron reads `\\` as `\` and cronie does not, so no `\` is left next to another.
    let [exe, script] =
        [job.exe, job.script].map(|path| strings::replace_owned(path, b"\\", b"\\''"));
    let (exe, script) = (BStr::new(&exe), BStr::new(&script));
    format!(
        "# bun-cron: {title}\n{schedule} '{exe}' run --cron-title={title} --cron-period='{schedule}' '{script}'\n"
    )
}

/// `table` without its empty lines, the marker lines of `title` and the line after each.
pub fn without_entry(table: &[u8], title: &Title) -> Vec<u8> {
    let marker = format!("# bun-cron: {title}");
    let mut kept = Vec::new();
    let mut lines = strings::split(table, b"\n");
    while let Some(line) = lines.next() {
        if strings::trim(line, b" \t") == marker.as_bytes() {
            lines.next();
        } else if !line.is_empty() {
            kept.extend_from_slice(line);
            kept.push(b'\n');
        }
    }
    kept
}
