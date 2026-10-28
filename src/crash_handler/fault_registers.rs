//! What the processor held at a fault, for the report of an executable that holds compiled code. No line gives away where
//! anything was loaded: a value that may be an address is printed by what it points into, or by its place in its page alone.

use core::cell::Cell;
use core::ffi::c_void;
use core::fmt::Write as _;

const NAMES: [(&str, libc::c_int); 16] = [
    ("rax", libc::REG_RAX),
    ("rbx", libc::REG_RBX),
    ("rcx", libc::REG_RCX),
    ("rdx", libc::REG_RDX),
    ("rsi", libc::REG_RSI),
    ("rdi", libc::REG_RDI),
    ("rbp", libc::REG_RBP),
    ("rsp", libc::REG_RSP),
    ("r8", libc::REG_R8),
    ("r9", libc::REG_R9),
    ("r10", libc::REG_R10),
    ("r11", libc::REG_R11),
    ("r12", libc::REG_R12),
    ("r13", libc::REG_R13),
    ("r14", libc::REG_R14),
    ("r15", libc::REG_R15),
];
const BYTES_OF_CODE: usize = 16;
const PAGE: usize = 4096;
const REACH_OF_STACK: usize = 1 << 20;

#[derive(Clone, Copy)]
struct AtFault {
    registers: [usize; NAMES.len()],
    pc: usize,
    /// None where the processor could not read the instruction itself.
    code: Option<([u8; BYTES_OF_CODE], usize)>,
}

thread_local! {
    static AT_FAULT: Cell<Option<AtFault>> = const { Cell::new(None) };
}

/// In the signal handler. `fault`: the address that could not be reached, where the signal has one.
pub(crate) fn remember(context: *mut c_void, fault: Option<usize>) {
    if crate::build_id::build_id().is_none() {
        return;
    }
    // SAFETY: the kernel passes a valid ucontext_t as the handler's third argument.
    let gregs = unsafe {
        &(*context.cast::<libc::ucontext_t>().cast_const())
            .uc_mcontext
            .gregs
    };
    let pc = gregs[libc::REG_RIP as usize] as usize;
    let could_not_fetch = fault.is_some_and(|fault| fault.wrapping_sub(pc) < BYTES_OF_CODE);
    let code = (!could_not_fetch && (PAGE..1 << 47).contains(&pc)).then(|| {
        let length = BYTES_OF_CODE.min(PAGE - pc % PAGE);
        let mut bytes = [0u8; BYTES_OF_CODE];
        // SAFETY: the processor has just read the instruction at `pc`, and the copy ends with its page.
        unsafe { core::ptr::copy_nonoverlapping(pc as *const u8, bytes.as_mut_ptr(), length) };
        (bytes, length)
    });
    AT_FAULT.with(|cell| {
        cell.set(Some(AtFault {
            registers: NAMES.map(|(_, index)| gregs[index as usize] as usize),
            pc,
            code,
        }));
    });
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

/// Of the fault that this thread remembers, if any.
pub(crate) fn write_to(write: &mut dyn FnMut(&[u8])) {
    let Some(at_fault) = AT_FAULT.with(Cell::take) else {
        return;
    };
    let sp = at_fault.registers[7];
    let mut line = Line {
        bytes: [0; 1024],
        length: 0,
    };
    let _ = line.write_str("Registers:");
    for ((name, _), value) in NAMES.iter().zip(at_fault.registers) {
        let _ = write!(line, " {name}=");
        let _ = write_value(&mut line, value, sp);
    }
    let _ = line.write_str(" rip=");
    let _ = write_value(&mut line, at_fault.pc, sp);
    let _ = line.write_str("\nCode at rip:");
    match at_fault.code {
        Some((bytes, length)) => {
            for byte in &bytes[..length] {
                let _ = write!(line, " {byte:02x}");
            }
        }
        None => {
            let _ = line.write_str(" not readable");
        }
    }
    let _ = line.write_str("\n");
    write(&line.bytes[..line.length]);
}
