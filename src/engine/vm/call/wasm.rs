use smallvec::SmallVec;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WasmKind {
    /// In a register the upper half is clear.
    I32,
    I64,
    F32,
    F64,
    /// The bits of any `Value`.
    Value,
    NonNullValue,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WasmPlace {
    /// The number of a general register or, for a float, of a vector register.
    Register(u8),
    /// A word at that distance from the stack pointer of the caller.
    Stack(u32),
}

/// What a compiler needs to call a function of WebAssembly without its entry. It holds for as long as the function
/// object lives.
///
/// The call goes to the address at `slot`, with `slot` where C functions take no argument first (`rax`, `x9`),
/// `instance` in the register of the `Vm`, and the word at `offset_of_memory_base` in it in that of the number tag. The
/// call site of the frame is current. The call can do what a script can, and throws as a call of one does. No register
/// but the frame pointer survives it, not even the stack pointer. The result is where C functions return one. A NaN
/// can have any bits.
pub struct WasmCallee {
    pub instance: usize,
    pub slot: usize,
    pub offset_of_memory_base: i32,
    pub parameters: SmallVec<[(WasmKind, WasmPlace); 8]>,
    pub result: Option<WasmKind>,
    /// From the stack pointer up they are the callee's. A multiple of 16.
    pub outgoing_bytes: u32,
}
