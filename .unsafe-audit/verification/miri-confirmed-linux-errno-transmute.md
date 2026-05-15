# Miri-Confirmed UB: `linux_errno::impl GetErrno for usize` Transmute

**Status:** UB detected by `cargo +nightly miri run`.
**Bug:** pass-2 pre-existing-ub-001 — `impl GetErrno for usize` transmutes `(int as u16) → SystemErrno` where `SystemErrno` has dense discriminants only in `0..=~133` but the SAFETY comment claims `int ∈ [0, 4096)`.
**Source:** `src/errno/linux_errno.rs:175-188`

## The reproduction

A minimal cargo project at `/tmp/miri-repro2/`:

```rust
// /tmp/miri-repro2/src/main.rs
#[repr(u16)]
#[derive(Copy, Clone, Debug, PartialEq)]
#[allow(dead_code)]
// Dense discriminants 0..=10 (simulating real Bun SystemErrno: dense 0..=~133)
enum SystemErrno {
    SUCCESS = 0, EPERM = 1, ENOENT = 2, ESRCH = 3, EINTR = 4,
    EIO = 5, ENXIO = 6, E2BIG = 7, ENOEXEC = 8, EBADF = 9, ECHILD = 10,
}

fn from_raw_buggy(n: u16) -> SystemErrno {
    // Mirrors src/errno/linux_errno.rs:185
    // SAFETY: int is in [0, 4096); E is repr over kernel errno range
    // BUG: out-of-range bytes → niche violation
    unsafe { core::mem::transmute::<u16, SystemErrno>(n) }
}

fn main() {
    // Mirror kernel rc=-EHWPOISON+1 = -134, exactly how the Bun impl
    // computes it: `signed = self as isize; int = -signed if -4096 < signed < 0`
    let attacker_kernel_rc: usize = 0_usize.wrapping_sub(134);
    let signed = attacker_kernel_rc as isize;
    let int = if signed > -4096 && signed < 0 { -signed } else { 0 };
    println!("int (input to transmute): {}", int);
    let result = from_raw_buggy(int as u16);
    println!("result discriminant: {:?}", result);  // UB
}
```

## The miri output

```
error: Undefined Behavior: constructing invalid value of type SystemErrno:
       at .<enum-tag>, encountered 0x0086, but expected a valid enum tag
  --> src/main.rs:26:14
   |
26 |     unsafe { core::mem::transmute::<u16, SystemErrno>(n) }
   |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Undefined Behavior occurred here
   |
   = note: stack backtrace:
           0: from_raw_buggy
               at src/main.rs:26:14: 26:57
           1: main
               at src/main.rs:40:18: 40:44
```

`0x0086` = 134 — exactly the input value, which is outside the enum's discriminant set. Miri detects this at the transmute site, not at a later use. The check is per Rust's validity invariant for `#[repr(u16)]` enums.

## What this proves about the Bun bug

The audit's static-analysis claim — "if any future caller passes a u16 outside 0..=~133, this is immediate UB" — is concretely verifiable. The exact bit pattern produced by the existing impl's arithmetic (`(self as isize).wrapping_neg() as u16` for `self` near `0_usize.wrapping_sub(134)`) DOES produce out-of-range values.

The current Bun source has NO LIVE CALLERS today (Bun's Linux raw-syscall layer routes through rustix). But the impl is `pub` in `bun_errno`, and any future caller following the Zig porting reference verbatim (`@as(usize, @bitCast(rc))` + `getErrno`) will introduce the bug exactly as reproduced here.

## What this means for the audit's defensibility

This is strong runtime evidence for a latent-UB finding:
1. A concrete miri trace
2. Reproduced from the exact arithmetic Bun's source uses
3. Triggering UB at the same line (`core::mem::transmute::<u16, _>`) Bun has

The proposed fix (`strum::FromRepr` + `unwrap_or(SUCCESS)`) is what the audit's C-002 plan already recommends.

## Differential: pass-2 vs pass-4

- Pass 2 found this via static analysis. The agent identified the niche-violation potential by reading the SAFETY comment's claimed range and comparing to the enum's discriminant set.
- Pass 4 (this verification) confirms the same UB with a runtime trace.

The audit can now say: "this is a latent UB bug; the proposed checked conversion fixes the reproduced failure mode; here is the miri output that demonstrates it."
