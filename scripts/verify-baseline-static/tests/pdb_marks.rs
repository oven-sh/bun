//! The scanner on a PE and PDB pair with the records that cl writes for
//! switch tables in .text. `fixtures/switch-table.s` is their source and says
//! what each procedure is for.

use std::process::{Command, Output};

/// Everything the fixture may report, by symbol name:
///
/// - The five one-instruction procedures report their VADDPS: a record that is
///   typed, named, after the procedure's scope or not placed is no table mark.
/// - `switch_table` reports the VZEROUPPER in its code and nothing from its
///   table. Without the table's mark, the sweep reads entry 6 of the table as
///   `0x014519c364  Vphsubw  (AVX)`.
/// - `two_level` reports the VZEROUPPER in its byte table, so the sweep was in
///   step there, and neither VADDPS in front of its two jump tables.
/// - `static_procedure` (an `S_LPROC32`) and `inlined_call` (an inline-site
///   scope ends before its table record) report their VZEROUPPER and not the
///   VADDPS in front of their tables.
const VIOLATIONS: &str = "\
VIOLATIONS (would SIGILL on x86-64 Nehalem (no AVX/AES-NI/BMI)):

  inlined_call  [AVX]  (1 insns)
    0x014519c3b0  Vzeroupper  (AVX)
  named_record  [AVX]  (1 insns)
    0x014519c020  Vaddps  (AVX)
  no_record  [AVX]  (1 insns)
    0x014519c000  Vaddps  (AVX)
  record_after_the_scope  [AVX]  (1 insns)
    0x014519c030  Vaddps  (AVX)
  static_procedure  [AVX]  (1 insns)
    0x014519c3a0  Vzeroupper  (AVX)
  switch_table  [AVX]  (1 insns)
    0x014519c213  Vzeroupper  (AVX)
  two_level  [AVX]  (1 insns)
    0x014519c386  Vzeroupper  (AVX)
  typed_record  [AVX]  (1 insns)
    0x014519c010  Vaddps  (AVX)
  unplaced_record  [AVX]  (1 insns)
    0x014519c040  Vaddps  (AVX)
";

/// Runs the scanner on the fixture. It finds switch-table.pdb next to the DLL.
fn scan(min_data_ranges: &str) -> (Option<i32>, String, String) {
    let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
    let Output {
        status,
        stdout,
        stderr,
    } = Command::new(env!("CARGO_BIN_EXE_verify-baseline-static"))
        .args(["--binary", &format!("{fixtures}/switch-table.dll")])
        .args(["--allowlist", &format!("{fixtures}/no-allowlist.txt")])
        .args(["--min-data-ranges", min_data_ranges])
        .output()
        .expect("the scanner runs");
    let text = |bytes| String::from_utf8(bytes).expect("utf-8 output");
    (status.code(), text(stdout), text(stderr))
}

#[test]
fn switch_tables_that_the_pdb_marks_are_not_decoded() {
    let (code, stdout, stderr) = scan("5");
    let (violations, _) = stdout
        .split_once("\nSUMMARY:\n")
        .unwrap_or_else(|| panic!("no summary.\nstdout:\n{stdout}\nstderr:\n{stderr}"));
    assert_eq!(violations, VIOLATIONS, "stderr:\n{stderr}");
    // The tables of `switch_table`, `static_procedure` and `inlined_call`, and
    // the two jump tables of `two_level`. Its byte table is the sixth mark.
    assert!(
        stderr.contains("(2560 bytes, 10 symbols, 5 data ranges)"),
        "{stderr}"
    );
    assert!(
        stderr.contains("\n6 table marks in the PDB, 5 of them jump tables\n"),
        "{stderr}"
    );
    assert_eq!(code, Some(1));
}

#[test]
fn a_scan_with_fewer_data_ranges_than_it_asks_for_is_a_tool_error() {
    let (code, stdout, stderr) = scan("6");
    assert_eq!(
        (code, stdout.as_str(), stderr.as_str()),
        (
            Some(2),
            "",
            "error: 5 data ranges, --min-data-ranges wants 6: the marks of data in .text \
             did not reach the scan (table marks in the PDB: 6)\n"
        )
    );
}
