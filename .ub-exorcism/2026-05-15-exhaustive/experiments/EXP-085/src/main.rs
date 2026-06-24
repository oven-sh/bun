use std::fmt;

#[derive(Copy, Clone)]
#[repr(transparent)]
struct Raw<'a>(&'a [u8]);

impl fmt::Display for Raw<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Mirrors src/bun_core/fmt.rs:725-731.
        f.write_str(unsafe { core::str::from_utf8_unchecked(self.0) })
    }
}

fn main() {
    // 0xff is not valid UTF-8. The important property is that constructing the
    // &str inside Display is already UB; no subsequent string operation is
    // needed to make the violation real.
    let attacker_bytes = [0xff_u8];
    let rendered = format!("{}", Raw(&attacker_bytes));
    // Force consumers to inspect the resulting str after Display hands it to
    // the formatter. If Miri does not signal here, the experiment still records
    // an important limitation: Rust's validity rule is violated at the
    // from_utf8_unchecked precondition, but this toolchain does not currently
    // instrument that library precondition.
    let _ = std::hint::black_box(rendered.chars().next());
}
