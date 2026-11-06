//! What the processor held at a fault, for the report of an executable that holds compiled code and of a thread that is at
//! work for a build. No line gives away where anything was loaded: a value that may be an address is printed by what it points
//! into, or by its place in its page alone.

use core::ffi::c_void;
use core::fmt::Write as _;

#[cfg(target_arch = "x86_64")]
const NAMES: [&str; 16] = [
    "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp", "r8", "r9", "r10", "r11", "r12", "r13",
    "r14", "r15",
];
#[cfg(target_arch = "aarch64")]
const NAMES: [&str; 32] = [
    "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9", "x10", "x11", "x12", "x13", "x14",
    "x15", "x16", "x17", "x18", "x19", "x20", "x21", "x22", "x23", "x24", "x25", "x26", "x27",
    "x28", "x29", "x30", "sp",
];
const NAME_OF_PC: &str = if cfg!(target_arch = "x86_64") {
    "rip"
} else {
    "pc"
};
/// An instruction of ARM64 is one word.
const BYTES_PRINTED_TOGETHER: usize = if cfg!(target_arch = "x86_64") { 1 } else { 4 };
const BYTES_OF_CODE: usize = 16;
const PAGE: usize = 4096;
const END_OF_ADDRESSES: usize = if cfg!(target_arch = "x86_64") {
    1 << 47
} else {
    1 << 48
};
const REACH_OF_STACK: usize = 1 << 20;

#[cfg(target_arch = "x86_64")]
fn read(context: *mut c_void) -> ([usize; NAMES.len()], usize, usize) {
    const INDICES: [libc::c_int; NAMES.len()] = [
        libc::REG_RAX,
        libc::REG_RBX,
        libc::REG_RCX,
        libc::REG_RDX,
        libc::REG_RSI,
        libc::REG_RDI,
        libc::REG_RBP,
        libc::REG_RSP,
        libc::REG_R8,
        libc::REG_R9,
        libc::REG_R10,
        libc::REG_R11,
        libc::REG_R12,
        libc::REG_R13,
        libc::REG_R14,
        libc::REG_R15,
    ];
    // SAFETY: the kernel passes a valid ucontext_t as the handler's third argument.
    let gregs = unsafe {
        &(*context.cast::<libc::ucontext_t>().cast_const())
            .uc_mcontext
            .gregs
    };
    let of = |index: libc::c_int| gregs[index as usize] as usize;
    (INDICES.map(of), of(libc::REG_RIP), of(libc::REG_RSP))
}

#[cfg(target_arch = "aarch64")]
fn read(context: *mut c_void) -> ([usize; NAMES.len()], usize, usize) {
    // SAFETY: the kernel passes a valid ucontext_t as the handler's third argument.
    let machine = unsafe { &(*context.cast::<libc::ucontext_t>().cast_const()).uc_mcontext };
    let sp = machine.sp as usize;
    let mut registers = [sp; NAMES.len()];
    for (register, value) in registers.iter_mut().zip(machine.regs) {
        *register = value as usize;
    }
    (registers, machine.pc as usize, sp)
}

struct Line {
    bytes: [u8; 1024],
    length: usize,
}

impl core::fmt::Write for Line {
    fn write_str(&mut self, text: &str) -> core::fmt::Result {
        let end = self.length + text.len();
        self.bytes
            .get_mut(self.length..end)
            .ok_or(core::fmt::Error)?
            .copy_from_slice(text.as_bytes());
        self.length = end;
        Ok(())
    }
}

fn write_value(line: &mut Line, value: usize, sp: usize) -> core::fmt::Result {
    let may_be_address = (1 << 32..1 << 48).contains(&value);
    if !may_be_address {
        write!(line, "{value:#x}")
    } else if let Some(offset) = crate::compiled_frames::offset_in_code(value) {
        write!(line, "code+{offset:#x}")
    } else if value.wrapping_sub(sp) < REACH_OF_STACK {
        write!(line, "stack+{:#x}", value - sp)
    } else if sp.wrapping_sub(value) < REACH_OF_STACK {
        write!(line, "stack-{:#x}", sp - value)
    } else {
        write!(line, "address..{:03x}", value % PAGE)
    }
}

/// `context`: the third argument of the signal handler, which has not returned. `fault`: the address that could not be
/// reached, where the signal has one.
pub(crate) fn write_to(context: *mut c_void, fault: Option<usize>, write: &mut dyn FnMut(&[u8])) {
    let holds_compiled_code = crate::build_id::build_id().is_some();
    if !holds_compiled_code && crate::stopped_builds::place_of_this_thread().is_none() {
        return;
    }
    let (registers, pc, sp) = read(context);
    let could_not_fetch = fault.is_some_and(|fault| fault.wrapping_sub(pc) < BYTES_OF_CODE);
    let code = (!could_not_fetch && (PAGE..END_OF_ADDRESSES).contains(&pc)).then(|| {
        let length = BYTES_OF_CODE.min(PAGE - pc % PAGE);
        let mut bytes = [0u8; BYTES_OF_CODE];
        // SAFETY: the processor has read the instruction at `pc`, and the copy ends with its page.
        unsafe { core::ptr::copy_nonoverlapping(pc as *const u8, bytes.as_mut_ptr(), length) };
        (bytes, length)
    });
    let mut line = Line {
        bytes: [0; 1024],
        length: 0,
    };
    let _ = line.write_str("Registers:");
    for (name, value) in NAMES.iter().zip(registers) {
        let _ = write!(line, " {name}=");
        let _ = write_value(&mut line, value, sp);
    }
    let _ = write!(line, " {NAME_OF_PC}=");
    let _ = write_value(&mut line, pc, sp);
    let _ = write!(line, "\nCode at {NAME_OF_PC}:");
    match code {
        Some((bytes, length)) => {
            for together in bytes[..length].as_chunks::<BYTES_PRINTED_TOGETHER>().0 {
                let _ = line.write_str(" ");
                for byte in together.iter().rev() {
                    let _ = write!(line, "{byte:02x}");
                }
            }
        }
        None => {
            let _ = line.write_str(" not readable");
        }
    }
    let _ = line.write_str("\n");
    write(&line.bytes[..line.length]);
}
