use bstr::BString;

use super::*;

const BUILD_ID: &[u8] = b"0123456789abcdef0123456789abcdef";

fn hello_world() -> BuildRows<'static> {
    BuildRows {
        bundle_time: Duration::from_millis(120),
        check_time: Duration::from_millis(522),
        compile_time: Duration::from_millis(118),
        module_count: 1,
        line_count: 1,
        untyped_file_count: 0,
        outfile: b"a",
        executable: Some(ExecutableSize {
            bytes: 126_400_000,
            trimmed_bytes: None,
        }),
        build_id: None,
    }
}

fn large_program() -> BuildRows<'static> {
    BuildRows {
        bundle_time: Duration::from_millis(1_500),
        check_time: Duration::from_millis(2_250),
        compile_time: Duration::from_millis(12_250),
        module_count: 1_200,
        line_count: 250_000,
        outfile: b"app",
        executable: Some(ExecutableSize {
            bytes: 200_500_000,
            trimmed_bytes: None,
        }),
        ..hello_world()
    }
}

fn written(rows: &BuildRows<'_>, has_colors: bool) -> BString {
    let mut out = Vec::new();
    write_build_rows(rows, has_colors, &mut out);
    BString::from(out)
}

fn plain(rows: &BuildRows<'_>) -> BString {
    written(rows, false)
}

fn rate(line_count: u64, milliseconds: u64) -> Option<String> {
    format_rate(line_count, Duration::from_millis(milliseconds))
}

#[test]
fn small_build_has_three_rows() {
    assert_eq!(
        plain(&hello_world()),
        concat!(
            "  [120ms]  bundle  1 module\n",
            "  [522ms]   check  1 line\n",
            "  [118ms] compile  a  126.4 MB\n",
        )
    );
}

#[test]
fn trimmed_size_follows_the_size() {
    let rows = BuildRows {
        bundle_time: Duration::from_millis(130),
        check_time: Duration::from_millis(674),
        compile_time: Duration::from_millis(166),
        executable: Some(ExecutableSize {
            bytes: 24_500_000,
            trimmed_bytes: Some(101_900_000),
        }),
        ..hello_world()
    };
    assert_eq!(
        plain(&rows),
        concat!(
            "  [130ms]  bundle  1 module\n",
            "  [674ms]   check  1 line\n",
            "  [166ms] compile  a  24.5 MB  (101.9 MB trimmed)\n",
        )
    );
}

#[test]
fn large_build_shows_its_rate() {
    assert_eq!(
        plain(&large_program()),
        concat!(
            "  [1.50s]  bundle  1,200 modules\n",
            "  [2.25s]   check  250,000 lines\n",
            " [12.25s] compile  app  200.5 MB  15.6k lines/s\n",
        )
    );
}

#[test]
fn times_of_any_width_align() {
    let rows = BuildRows {
        bundle_time: Duration::from_millis(5),
        check_time: Duration::from_millis(642),
        compile_time: Duration::from_millis(1_500),
        build_id: Some(BUILD_ID),
        ..hello_world()
    };
    assert_eq!(
        plain(&rows),
        concat!(
            "    [5ms]  bundle  1 module\n",
            "  [642ms]   check  1 line\n",
            "  [1.50s] compile  a  126.4 MB\n",
            "         build id  0123456789abcdef0123456789abcdef\n",
        )
    );
    let rows = BuildRows {
        compile_time: Duration::from_millis(12_250),
        ..rows
    };
    assert_eq!(
        plain(&rows),
        concat!(
            "    [5ms]  bundle  1 module\n",
            "  [642ms]   check  1 line\n",
            " [12.25s] compile  a  126.4 MB\n",
            "         build id  0123456789abcdef0123456789abcdef\n",
        )
    );
    let rows = BuildRows {
        compile_time: Duration::from_millis(1_234_567),
        ..rows
    };
    assert_eq!(
        plain(&rows),
        concat!(
            "      [5ms]  bundle  1 module\n",
            "    [642ms]   check  1 line\n",
            " [1234.57s] compile  a  126.4 MB\n",
            "           build id  0123456789abcdef0123456789abcdef\n",
        )
    );
}

#[test]
fn times_switch_to_seconds() {
    let format = |microseconds| format_time(Duration::from_micros(microseconds));
    assert_eq!(format(0), "[0ms]");
    assert_eq!(format(999_999), "[999ms]");
    assert_eq!(format(1_000_000), "[1.00s]");
    assert_eq!(format(1_004_000), "[1.00s]");
    assert_eq!(format(1_005_000), "[1.01s]");
    assert_eq!(format(59_999_000), "[60.00s]");
}

#[test]
fn untyped_files_are_on_check_row() {
    let row_with = |untyped_file_count| {
        let rows = BuildRows {
            untyped_file_count,
            ..large_program()
        };
        let text = plain(&rows).to_string();
        text.lines().nth(1).map(str::to_owned)
    };
    let row = "  [2.25s]   check  250,000 lines";
    assert_eq!(row_with(0).as_deref(), Some(row));
    assert_eq!(
        row_with(1),
        Some(format!("{row}  1 file compiled without types"))
    );
    assert_eq!(
        row_with(1_500),
        Some(format!("{row}  1,500 files compiled without types"))
    );
}

#[test]
fn rate_needs_a_thousand_lines() {
    assert_eq!(rate(999, 1), None);
    assert_eq!(rate(1_000, 0), None);
    assert_eq!(rate(1_000, 2_000).as_deref(), Some("500 lines/s"));
    assert_eq!(rate(1_000, 1_001).as_deref(), Some("999 lines/s"));
    assert_eq!(rate(1_000, 1_000).as_deref(), Some("1.0k lines/s"));
}

#[test]
fn rate_is_rounded_to_tenths() {
    assert_eq!(rate(12_949, 1_000).as_deref(), Some("12.9k lines/s"));
    assert_eq!(rate(12_950, 1_000).as_deref(), Some("13.0k lines/s"));
    assert_eq!(rate(999_949, 1_000).as_deref(), Some("999.9k lines/s"));
    assert_eq!(rate(999_950, 1_000).as_deref(), Some("1.0M lines/s"));
    assert_eq!(rate(1_234_567, 1_000).as_deref(), Some("1.2M lines/s"));
    assert!(rate(u64::MAX, 1).is_some());
}

#[test]
fn no_executable_leaves_only_its_name() {
    let rows = BuildRows {
        executable: None,
        ..hello_world()
    };
    assert!(plain(&rows).ends_with(b"  [118ms] compile  a\n"));
}

#[test]
fn note_rows_align_with_build_rows() {
    let rows = BuildRows {
        build_id: Some(BUILD_ID),
        ..hello_world()
    };
    let mut out = Vec::new();
    write_build_rows(&rows, false, &mut out);
    let lines = [&b"first line"[..], b"  second line"].map(<[u8]>::to_vec);
    write_note_row("trim", &lines, false, &mut out);
    assert_eq!(
        BString::from(out),
        concat!(
            "  [120ms]  bundle  1 module\n",
            "  [522ms]   check  1 line\n",
            "  [118ms] compile  a  126.4 MB\n",
            "         build id  0123456789abcdef0123456789abcdef\n",
            "             trim  first line\n",
            "                     second line\n",
        )
    );
}

#[test]
fn text_after_the_name_is_dimmed() {
    let rows = BuildRows {
        untyped_file_count: 2,
        build_id: Some(BUILD_ID),
        ..large_program()
    };
    let time = |text: &str| format!("\x1b[0m\x1b[2m[\x1b[1m{text}\x1b[0m\x1b[2m]\x1b[0m");
    let label = |text: &str| format!("\x1b[32m{text}\x1b[0m");
    let dimmed = |text: &str| format!("\x1b[2m{text}\x1b[0m");
    let expected = [
        format!("  {}  {}  1,200 modules\n", time("1.50s"), label("bundle")),
        format!(
            "  {}   {}  250,000 lines  {}\n",
            time("2.25s"),
            label("check"),
            dimmed("2 files compiled without types")
        ),
        format!(
            " {} {}  \x1b[1m\x1b[34mapp\x1b[0m  {}\n",
            time("12.25s"),
            label("compile"),
            dimmed("200.5 MB  15.6k lines/s")
        ),
        format!(
            "         {}  {}\n",
            label("build id"),
            dimmed("0123456789abcdef0123456789abcdef")
        ),
    ];
    assert_eq!(written(&rows, true), expected.concat());
}
