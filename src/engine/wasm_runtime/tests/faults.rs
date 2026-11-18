//! Faults that are not for the engine go where they went before. Each case runs in a process of its own,
//! which has to start without an engine, so there is one test only.

#![cfg(any(target_os = "linux", target_os = "macos"))]
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::ffi::{c_int, c_void};
use std::os::unix::process::ExitStatusExt;
use std::process::ExitStatus;
use std::rc::Rc;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options};
use bun_engine_exec_memory::{Priority, link};
use bun_engine_wasm_compiler::abi::{InstanceLayout, Trap};
use bun_engine_wasm_format::MemoryIndex;
use bun_engine_wasm_runtime::Reference;
use support::machine::{Failure, Machine};
use support::{engine, options, with_machine};

const HANDLED: i32 = 40;

extern "C" fn with_info(_: c_int, info: *mut libc::siginfo_t, context: *mut c_void) {
    // SAFETY: ends the process.
    unsafe { libc::_exit(HANDLED + i32::from(info.is_null() || context.is_null())) }
}

extern "C" fn plain(_: c_int) {
    // SAFETY: ends the process.
    unsafe { libc::_exit(HANDLED) }
}

extern "C" fn returning(_: c_int) {}

fn install(handler: usize, flags: c_int) {
    for signal in [libc::SIGSEGV, libc::SIGBUS] {
        // SAFETY: zeros are valid, and the handler has the type that the flags ask for.
        unsafe {
            let mut action = std::mem::MaybeUninit::<libc::sigaction>::zeroed().assume_init();
            action.sa_sigaction = handler;
            action.sa_flags = flags | libc::SA_ONSTACK;
            libc::sigaction(signal, &raw const action, std::ptr::null_mut());
        }
    }
}

fn read(address: usize) {
    // SAFETY: not at all.
    unsafe { std::ptr::with_exposed_provenance::<u8>(address).read_volatile() };
}

fn fault(machine: &Machine, how: &str) {
    let host = machine.host_function(
        None,
        Rc::new(|_, instance, _| {
            read(instance.memory(MemoryIndex(0)).pages().base().addr() + (1 << 16));
            Ok(vec![])
        }),
    );
    let instance = machine.load(
        r#"(import "" "host" (func $host)) (memory 1) (type $s (struct (field i32)))
        (func (export "host") (call $host))
        (func (export "field") (param (ref null $s)) (result i32) (struct.get $s 0 (local.get 0)))
        (func $deep (export "deep") (call $deep))"#,
        &[("host", &host)],
    );
    let null = machine.invoke(instance, "field", &[Reference::NULL.into()]);
    assert_eq!(null, Err(Failure::Trap(Trap::NullReference)));
    match how {
        "native" => read(8),
        "host function" => drop(machine.invoke(instance, "host", &[])),
        "wild reference" => drop(machine.invoke(instance, "field", &[0x10_0000])),
        "no address" => drop(machine.invoke(instance, "field", &[0x1_0000_0000_0000])),
        "end of the stack" => {
            let limit = InstanceLayout::entry_limit(machine.engine().layout());
            let limit = instance.cell().address() + limit as usize;
            // SAFETY: not at all.
            unsafe { std::ptr::with_exposed_provenance_mut::<usize>(limit).write(4096) };
            drop(machine.invoke(instance, "deep", &[]));
        }
        "other code" => {
            let mut masm = MacroAssembler::new(Options {
                features: Features::empty(),
                shorten_jumps: false,
                seed: 0,
            });
            masm.load64(abi::RETURN_GPRS[0], Absolute(8));
            masm.ret();
            let code = link(
                &masm.finish().unwrap(),
                Priority::Required,
                |_| unreachable!(),
            );
            let code = code.unwrap();
            // SAFETY: it has this type.
            unsafe { std::mem::transmute::<usize, extern "C" fn()>(code.start())() };
        }
        // SAFETY: no pointers.
        "sent" => drop(unsafe { libc::raise(libc::SIGSEGV) }),
        _ => unreachable!(),
    }
}

fn child(handler: &str, how: &str) -> ! {
    let no_core = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: the pointer is valid.
    unsafe { libc::setrlimit(libc::RLIMIT_CORE, &raw const no_core) };
    match handler {
        "with info" => install(with_info as *const () as usize, libc::SA_SIGINFO),
        "plain" => install(plain as *const () as usize, 0),
        "ignored" => install(libc::SIG_IGN, 0),
        "once" => install(returning as *const () as usize, libc::SA_RESETHAND),
        _ => install(libc::SIG_DFL, 0),
    }
    with_machine(engine(options()), |machine| {
        let mut stack = vec![0u8; 64 << 10];
        let stack = libc::stack_t {
            ss_sp: stack.as_mut_ptr().cast(),
            ss_flags: 0,
            ss_size: stack.len(),
        };
        // SAFETY: the process ends before the memory is freed.
        unsafe {
            libc::sigaltstack(&raw const stack, std::ptr::null_mut());
            fault(machine, how);
            libc::_exit(0)
        }
    })
}

#[test]
fn faults_of_others_are_passed_on() {
    let ways = [
        "native",
        "host function",
        "wild reference",
        #[cfg(target_arch = "x86_64")]
        "no address",
        "end of the stack",
        "other code",
        "sent",
    ];
    for how in ways {
        for handler in ["with info", "plain", "once", "ignored", "default"] {
            let mut status = 0;
            // SAFETY: the only other thread waits for this one.
            unsafe {
                match libc::fork() {
                    0 => child(handler, how),
                    process => libc::waitpid(process, &raw mut status, 0),
                }
            };
            let status = ExitStatus::from_raw(status);
            let is_right = match (handler, how) {
                ("once", "sent") => status.success(),
                ("ignored", "sent") => status.success() || cfg!(target_os = "macos"),
                ("once" | "ignored" | "default", _) => {
                    matches!(status.signal(), Some(libc::SIGSEGV | libc::SIGBUS))
                }
                _ => status.code() == Some(HANDLED),
            };
            assert!(is_right, "{handler}/{how}: {status}");
        }
    }
}
