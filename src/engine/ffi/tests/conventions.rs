use bun_engine_asm::{arm64, x64};
use bun_engine_exec_memory::{Priority, link};
use bun_engine_ffi::NativeType::{Bool, Double, Float, Int8, Int32, Int64, Pointer, Uint8, Uint16};
use bun_engine_ffi::Place::{Fpr, Gpr, Stack};
use bun_engine_ffi::{Convention, NativeType, stubs};
use bun_engine_standalone as _;

#[test]
fn system_v_counts_each_bank() {
    let layout = Convention::SYSTEM_V.layout(&[
        Int32, Float, Int8, Double, Int64, Int64, Int64, Pointer, Uint8, Uint16,
    ]);
    assert_eq!(layout.places[1], Fpr(x64::XMM0));
    assert_eq!(layout.places[2], Gpr(x64::RSI));
    assert_eq!(layout.places[7..], [Gpr(x64::R9), Stack(0), Stack(8)]);
    assert_eq!(layout.stack_bytes, 16);
    assert_eq!(layout.float_count, Some((x64::RAX, 2)));
}

#[test]
fn windows_counts_positions() {
    let layout = Convention::WINDOWS_X64.layout(&[Int32, Float, Int8, Double, Float, Uint8]);
    let registers = [Gpr(x64::RCX), Fpr(x64::XMM1), Gpr(x64::R8), Fpr(x64::XMM3)];
    assert_eq!(layout.places[..4], registers);
    assert_eq!(layout.places[4..], [Stack(32), Stack(40)]);
    assert_eq!(layout.stack_bytes, 48);
    assert_eq!(Convention::WINDOWS_X64.layout(&[]).stack_bytes, 32);
}

#[test]
fn only_apple_packs_the_stack() {
    let arguments = [[Int64; 8].as_slice(), &[Int8, Uint16, Bool, Int32, Int64]].concat();
    let (standard, apple) = (
        Convention::AAPCS64.layout(&arguments),
        Convention::APPLE_ARM64.layout(&arguments),
    );
    assert_eq!(standard.places[7], Gpr(arm64::X7));
    assert_eq!(standard.places[8..], [0, 8, 16, 24, 32].map(Stack));
    assert_eq!(apple.places[8..], [0, 2, 4, 8, 16].map(Stack));
    assert_eq!((standard.stack_bytes, apple.stack_bytes), (48, 32));
}

const ARGUMENTS: [NativeType; 11] = [
    Int8, Float, Uint16, Double, Int64, Bool, Int32, Uint8, Float, Int8, Uint16,
];
const SLOTS: [u64; 11] = [
    -1_i64 as u64,
    0.5_f32.to_bits() as u64,
    0xffff,
    0.25_f64.to_bits(),
    1 << 40,
    1,
    i32::MIN as u64,
    0xff,
    2.0_f32.to_bits() as u64,
    -128_i64 as u64,
    7,
];

/// From an invoker to a callback of the same signature, and from one to a function.
macro_rules! round_trips {
    ($name:ident, $abi:literal, $convention:expr) => {
        #[test]
        fn $name() {
            type Stub = unsafe extern $abi fn(usize, *const [u64; 11]) -> u64;

            unsafe extern $abi fn receive(_: usize, slots: *const [u64; 11]) -> u64 {
                // SAFETY: one for each argument.
                assert_eq!(unsafe { *slots }, SLOTS);
                1.5_f32.to_bits().into()
            }

            #[allow(clippy::too_many_arguments)]
            extern $abi fn function(
                a: i8, b: f32, c: u16, d: f64, e: i64, f: bool, g: i32, h: u8, i: f32, j: i8, k: u16,
            ) -> f32 {
                assert_eq!((a, b, c, d, e, f), (-1, 0.5, 0xffff, 0.25, 1 << 40, true));
                assert_eq!((g, h, i, j, k), (i32::MIN, 0xff, 2.0, -128, 7));
                1.5
            }

            let install = |code| link(&code, Priority::Required, |_| unreachable!()).unwrap();
            let invoker = install(stubs::invoker(&$convention, &ARGUMENTS, Float));
            let body = install(stubs::callback_body(&$convention, &ARGUMENTS, Float));
            let receiver: Stub = receive;
            let context = (&raw const receiver).expose_provenance();
            let entry = install(stubs::callback_entry(context, body.start()));
            for target in [entry.start(), function as *const () as usize] {
                // SAFETY: made for that convention and for the signature of both.
                let result = unsafe {
                    core::mem::transmute::<usize, Stub>(invoker.start())(target, &SLOTS)
                };
                assert_eq!(result, 1.5_f32.to_bits().into());
            }
        }
    };
}

round_trips!(by_the_convention_of_the_host, "C", Convention::HOST);
#[cfg(target_arch = "x86_64")]
round_trips!(by_that_of_windows, "win64", Convention::WINDOWS_X64);
#[cfg(target_arch = "x86_64")]
round_trips!(by_that_of_system_v, "sysv64", Convention::SYSTEM_V);
