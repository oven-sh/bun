//! Machine code does what the interpreter says.

mod support;

use support::harness::campaign;
use support::native::{Architecture, Native};

#[test]
fn x64() {
    campaign(600, || Native::new(Architecture::X64));
}

#[test]
fn arm64() {
    campaign(600, || Native::new(Architecture::Arm64));
}
