//! Encodes x86-64 instructions written in AT&T syntax, for GCC extended `asm` statements.
//!
//! The input is the statement's template after operand substitution: every operand is already a
//! register name, an immediate, or a memory reference. There are no symbols: the code is placed at
//! an address nobody knows here, so only numeric local labels (`1:`, `jne 1b`) can be branched to.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Size {
    B,
    W,
    L,
    Q,
}

impl Size {
    fn bytes(self) -> u8 {
        match self {
            Size::B => 1,
            Size::W => 2,
            Size::L => 4,
            Size::Q => 8,
        }
    }

    fn from_suffix(byte: u8) -> Option<Size> {
        match byte {
            b'b' => Some(Size::B),
            b'w' => Some(Size::W),
            b'l' => Some(Size::L),
            b'q' => Some(Size::Q),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Gpr {
    number: u8,
    size: Size,
    /// `ah`, `ch`, `dh`, `bh`: encoded as 4..7 and only without a REX prefix.
    high: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
struct Mem {
    /// 0x64 (`fs`) or 0x65 (`gs`).
    segment: Option<u8>,
    base: Option<u8>,
    index: Option<u8>,
    scale: u8,
    displacement: i64,
    /// The base and index were named as 32-bit registers.
    address32: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Operand {
    Gpr(Gpr),
    Xmm(u8),
    Imm(i64),
    Mem(Mem),
    /// `1f` / `1b`.
    Label {
        number: u32,
        forward: bool,
    },
}

type Res<T> = Result<T, String>;

use bun_core::strings;

fn gpr_by_name(name: &[u8]) -> Option<Gpr> {
    const Q: [&[u8]; 8] = [
        b"rax", b"rcx", b"rdx", b"rbx", b"rsp", b"rbp", b"rsi", b"rdi",
    ];
    const L: [&[u8]; 8] = [
        b"eax", b"ecx", b"edx", b"ebx", b"esp", b"ebp", b"esi", b"edi",
    ];
    const W: [&[u8]; 8] = [b"ax", b"cx", b"dx", b"bx", b"sp", b"bp", b"si", b"di"];
    const B: [&[u8]; 8] = [b"al", b"cl", b"dl", b"bl", b"spl", b"bpl", b"sil", b"dil"];
    const H: [&[u8]; 4] = [b"ah", b"ch", b"dh", b"bh"];
    let find = |table: &[&[u8]]| table.iter().position(|candidate| *candidate == name);
    let make = |number: usize, size| Gpr {
        number: number as u8,
        size,
        high: false,
    };
    if let Some(number) = find(&Q) {
        return Some(make(number, Size::Q));
    }
    if let Some(number) = find(&L) {
        return Some(make(number, Size::L));
    }
    if let Some(number) = find(&W) {
        return Some(make(number, Size::W));
    }
    if let Some(number) = find(&B) {
        return Some(make(number, Size::B));
    }
    if let Some(number) = find(&H) {
        return Some(Gpr {
            number: number as u8 + 4,
            size: Size::B,
            high: true,
        });
    }
    // r8..r15 with an optional d / w / b (or l) suffix.
    let rest = name.strip_prefix(b"r")?;
    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    if digits == 0 {
        return None;
    }
    let number: u8 = std::str::from_utf8(&rest[..digits]).ok()?.parse().ok()?;
    if !(8..=15).contains(&number) {
        return None;
    }
    let size = match &rest[digits..] {
        b"" => Size::Q,
        b"d" => Size::L,
        b"w" => Size::W,
        b"b" | b"l" => Size::B,
        _ => return None,
    };
    Some(Gpr {
        number,
        size,
        high: false,
    })
}

fn xmm_by_name(name: &[u8]) -> Option<u8> {
    let digits = name.strip_prefix(b"xmm")?;
    let number: u8 = std::str::from_utf8(digits).ok()?.parse().ok()?;
    (number < 16).then_some(number)
}

fn parse_integer(text: &[u8]) -> Res<i64> {
    let text = std::str::from_utf8(text).map_err(|_| "a number is not text".to_string())?;
    let text = text.trim();
    let (negative, digits) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text.strip_prefix('+').unwrap_or(text)),
    };
    let digits = digits.trim_end_matches(['u', 'U', 'l', 'L']);
    let magnitude = if let Some(hex) = digits
        .strip_prefix("0x")
        .or_else(|| digits.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16)
    } else if digits.len() > 1 && digits.starts_with('0') {
        u64::from_str_radix(&digits[1..], 8)
    } else {
        digits.parse::<u64>()
    }
    .map_err(|_| format!("'{text}' is not a number"))?;
    Ok(if negative {
        (magnitude as i64).wrapping_neg()
    } else {
        magnitude as i64
    })
}

fn trim(text: &[u8]) -> &[u8] {
    let start = text
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(text.len());
    let end = text
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
        .map_or(start, |at| at + 1);
    &text[start..end]
}

fn parse_operand(text: &[u8]) -> Res<Operand> {
    let text = trim(text);
    let show = || crate::token::display_bytes(text);
    if let Some(immediate) = text.strip_prefix(b"$") {
        return Ok(Operand::Imm(parse_integer(immediate)?));
    }
    // A register on its own.
    if let Some(name) = text.strip_prefix(b"%") {
        if strings::index_of_char_usize(name, b':').is_none()
            && strings::index_of_char_usize(name, b'(').is_none()
        {
            if let Some(register) = gpr_by_name(name) {
                return Ok(Operand::Gpr(register));
            }
            if let Some(number) = xmm_by_name(name) {
                return Ok(Operand::Xmm(number));
            }
            return Err(format!(
                "'{}' is not a register that can be used here",
                show()
            ));
        }
    }
    // `1f`, `1b`.
    if text.len() >= 2 && text[..text.len() - 1].iter().all(u8::is_ascii_digit) {
        let direction = text[text.len() - 1];
        if direction == b'f' || direction == b'b' {
            let number = std::str::from_utf8(&text[..text.len() - 1])
                .ok()
                .and_then(|digits| digits.parse().ok())
                .ok_or_else(|| format!("'{}' is not a label", show()))?;
            return Ok(Operand::Label {
                number,
                forward: direction == b'f',
            });
        }
    }
    // [%seg:][disp][(base[,index[,scale]])]
    let mut memory = Mem {
        scale: 1,
        ..Mem::default()
    };
    let mut rest = text;
    if let Some(after) = rest.strip_prefix(b"%fs:") {
        memory.segment = Some(0x64);
        rest = after;
    } else if let Some(after) = rest.strip_prefix(b"%gs:") {
        memory.segment = Some(0x65);
        rest = after;
    }
    let (displacement, registers) = match strings::index_of_char_usize(rest, b'(') {
        Some(open) => {
            let close = strings::last_index_of_char(rest, b')')
                .ok_or_else(|| format!("'{}' has no ')'", show()))?;
            if !trim(&rest[close + 1..]).is_empty() {
                return Err(format!("'{}' has something after ')'", show()));
            }
            (&rest[..open], Some(&rest[open + 1..close]))
        }
        None => (rest, None),
    };
    if !trim(displacement).is_empty() {
        memory.displacement = parse_integer(displacement)?;
    } else if registers.is_none() {
        return Err(format!("'{}' is not an operand", show()));
    }
    if let Some(registers) = registers {
        let mut parts = strings::split(registers, b",").map(trim);
        let mut address_register = |part: &[u8]| -> Res<Option<u8>> {
            if part.is_empty() {
                return Ok(None);
            }
            let name = part.strip_prefix(b"%").ok_or_else(|| {
                format!("'{}' is not a register", crate::token::display_bytes(part))
            })?;
            if name == b"rip" {
                return Err(
                    "a %rip-relative address has nothing to be relative to here".to_string()
                );
            }
            let register = gpr_by_name(name).ok_or_else(|| {
                format!("'{}' is not a register", crate::token::display_bytes(part))
            })?;
            match register.size {
                Size::Q => {}
                Size::L => memory.address32 = true,
                _ => {
                    return Err(format!(
                        "'{}' cannot hold an address",
                        crate::token::display_bytes(part)
                    ));
                }
            }
            Ok(Some(register.number))
        };
        memory.base = address_register(parts.next().unwrap_or(b""))?;
        if let Some(index) = parts.next() {
            memory.index = address_register(index)?;
            if memory.index == Some(4) {
                return Err("%rsp cannot be an index register".to_string());
            }
        }
        if let Some(scale) = parts.next() {
            if !scale.is_empty() {
                memory.scale = match parse_integer(scale)? {
                    1 => 1,
                    2 => 2,
                    4 => 4,
                    8 => 8,
                    _ => return Err(format!("'{}' has a scale that is not 1, 2, 4 or 8", show())),
                };
            }
        }
        if parts.next().is_some() {
            return Err(format!("'{}' has too many parts", show()));
        }
    }
    Ok(Operand::Mem(memory))
}

/// One instruction being put together.
#[derive(Default)]
struct Encoding {
    bytes: Vec<u8>,
}

/// The register-or-memory half of a ModRM byte.
#[derive(Clone, Copy)]
enum Rm {
    Register(u8),
    Memory(Mem),
}

struct Parts<'a> {
    /// Mandatory prefixes (`66`, `F2`, `F3`) that precede REX, in order.
    prefixes: &'a [u8],
    /// REX.W.
    wide: bool,
    /// Byte registers 4..7 without REX are `ah`..`bh`; with it `spl`..`dil`.
    byte_registers: &'a [Gpr],
    opcode: &'a [u8],
    /// ModRM.reg: a register number or an opcode extension.
    reg: u8,
    rm: Rm,
    immediate: Option<(i64, u8)>,
}

impl Encoding {
    fn emit(&mut self, parts: &Parts) -> Res<()> {
        let (rm_low, rex_b, rex_x, memory) = match parts.rm {
            Rm::Register(number) => (number & 7, number >> 3, 0, None),
            Rm::Memory(memory) => (
                0,
                memory.base.unwrap_or(0) >> 3,
                memory.index.unwrap_or(0) >> 3,
                Some(memory),
            ),
        };
        if let Some(memory) = memory {
            if let Some(segment) = memory.segment {
                self.bytes.push(segment);
            }
            if memory.address32 {
                self.bytes.push(0x67);
            }
        }
        self.bytes.extend_from_slice(parts.prefixes);
        let needs_rex_for_byte = parts.byte_registers.iter().any(|register| {
            register.size == Size::B && !register.high && (4..8).contains(&register.number)
        });
        let has_high_byte = parts.byte_registers.iter().any(|register| register.high);
        let rex =
            0x40 | (u8::from(parts.wide) << 3) | ((parts.reg >> 3) << 2) | (rex_x << 1) | rex_b;
        if rex != 0x40 || needs_rex_for_byte {
            if has_high_byte {
                return Err("%ah, %ch, %dh and %bh cannot be used together with %spl, %sil, %r8 and later, or a 64-bit operand".to_string());
            }
            self.bytes.push(rex);
        }
        self.bytes.extend_from_slice(parts.opcode);
        let reg_low = parts.reg & 7;
        match memory {
            None => self.bytes.push(0xc0 | (reg_low << 3) | rm_low),
            Some(memory) => self.modrm_memory(reg_low, memory)?,
        }
        if let Some((value, size)) = parts.immediate {
            self.immediate(value, size);
        }
        Ok(())
    }

    fn immediate(&mut self, value: i64, size: u8) {
        self.bytes
            .extend_from_slice(&value.to_le_bytes()[..usize::from(size)]);
    }

    fn modrm_memory(&mut self, reg_low: u8, memory: Mem) -> Res<()> {
        let displacement = memory.displacement;
        let fits32 = i32::try_from(displacement).is_ok()
            || (memory.address32 && u32::try_from(displacement).is_ok());
        if !fits32 {
            return Err("an address displacement does not fit in 32 bits".to_string());
        }
        let scale_bits = match memory.scale {
            1 => 0,
            2 => 1,
            4 => 2,
            _ => 3,
        };
        match (memory.base, memory.index) {
            (None, None) => {
                // No registers: mod 00, rm 100, SIB with no index and no base. (mod 00, rm 101
                // would be relative to the instruction's own address.)
                self.bytes.push((reg_low << 3) | 4);
                self.bytes.push(0x25);
                self.immediate(displacement, 4);
            }
            (None, Some(index)) => {
                self.bytes.push((reg_low << 3) | 4);
                self.bytes.push((scale_bits << 6) | ((index & 7) << 3) | 5);
                self.immediate(displacement, 4);
            }
            (Some(base), index) => {
                let base_low = base & 7;
                // rbp / r13 as a base have no displacement-free form.
                let (mode, width) = if displacement == 0 && base_low != 5 {
                    (0u8, 0u8)
                } else if i8::try_from(displacement).is_ok() {
                    (1, 1)
                } else {
                    (2, 4)
                };
                match index {
                    None if base_low != 4 => {
                        self.bytes.push((mode << 6) | (reg_low << 3) | base_low)
                    }
                    None => {
                        // rsp / r12 as a base need the SIB byte that says "no index".
                        self.bytes.push((mode << 6) | (reg_low << 3) | 4);
                        self.bytes.push(0x24);
                    }
                    Some(index) => {
                        self.bytes.push((mode << 6) | (reg_low << 3) | 4);
                        self.bytes
                            .push((scale_bits << 6) | ((index & 7) << 3) | base_low);
                    }
                }
                if width != 0 {
                    self.immediate(displacement, width);
                }
            }
        }
        Ok(())
    }

    /// A VEX-encoded instruction on general registers (the BMI group).
    fn emit_vex(
        &mut self,
        map: u8,
        prefix: u8,
        wide: bool,
        opcode: u8,
        reg: u8,
        vvvv: u8,
        rm: Rm,
        immediate: Option<u8>,
    ) -> Res<()> {
        let (rm_low, rex_b, rex_x, memory) = match rm {
            Rm::Register(number) => (number & 7, number >> 3, 0, None),
            Rm::Memory(memory) => (
                0,
                memory.base.unwrap_or(0) >> 3,
                memory.index.unwrap_or(0) >> 3,
                Some(memory),
            ),
        };
        if let Some(memory) = memory {
            if let Some(segment) = memory.segment {
                self.bytes.push(segment);
            }
            if memory.address32 {
                self.bytes.push(0x67);
            }
        }
        self.bytes.push(0xc4);
        self.bytes
            .push((((reg >> 3) ^ 1) << 7) | ((rex_x ^ 1) << 6) | ((rex_b ^ 1) << 5) | map);
        self.bytes
            .push((u8::from(wide) << 7) | (((vvvv ^ 0xf) & 0xf) << 3) | prefix);
        self.bytes.push(opcode);
        match memory {
            None => self.bytes.push(0xc0 | ((reg & 7) << 3) | rm_low),
            Some(memory) => self.modrm_memory(reg & 7, memory)?,
        }
        if let Some(immediate) = immediate {
            self.bytes.push(immediate);
        }
        Ok(())
    }
}

fn condition_code(name: &[u8]) -> Option<u8> {
    Some(match name {
        b"o" => 0,
        b"no" => 1,
        b"b" | b"c" | b"nae" => 2,
        b"ae" | b"nb" | b"nc" => 3,
        b"e" | b"z" => 4,
        b"ne" | b"nz" => 5,
        b"be" | b"na" => 6,
        b"a" | b"nbe" => 7,
        b"s" => 8,
        b"ns" => 9,
        b"p" | b"pe" => 10,
        b"np" | b"po" => 11,
        b"l" | b"nge" => 12,
        b"ge" | b"nl" => 13,
        b"le" | b"ng" => 14,
        b"g" | b"nle" => 15,
        _ => return None,
    })
}

fn rm_of(operand: &Operand) -> Option<Rm> {
    match operand {
        Operand::Gpr(register) => Some(Rm::Register(register.number)),
        Operand::Xmm(number) => Some(Rm::Register(*number)),
        Operand::Mem(memory) => Some(Rm::Memory(*memory)),
        _ => None,
    }
}

fn gprs_in(operands: &[Operand]) -> Vec<Gpr> {
    operands
        .iter()
        .filter_map(|operand| match operand {
            Operand::Gpr(register) => Some(*register),
            _ => None,
        })
        .collect()
}

/// The operand size: the suffix if there is one, else the size of a register operand.
fn operation_size(suffix: Option<Size>, operands: &[Operand], mnemonic: &str) -> Res<Size> {
    let from_registers = gprs_in(operands).last().map(|register| register.size);
    match (suffix, from_registers) {
        (Some(size), _) => Ok(size),
        (None, Some(size)) => Ok(size),
        (None, None) => Err(format!(
            "'{mnemonic}' needs a size suffix (b, w, l or q): no operand is a register"
        )),
    }
}

fn size_prefix(size: Size) -> &'static [u8] {
    if size == Size::W { &[0x66] } else { &[] }
}

/// `opcode` for the 16/32/64-bit form; the byte form is one less.
fn sized_opcode(opcode: u8, size: Size) -> u8 {
    if size == Size::B { opcode - 1 } else { opcode }
}

fn check_immediate(value: i64, size: Size, mnemonic: &str) -> Res<()> {
    let fits = match size {
        Size::B => (-128..=255).contains(&value),
        Size::W => (-32768..=65535).contains(&value),
        Size::L => (-(1i64 << 31)..(1i64 << 32)).contains(&value),
        Size::Q => i32::try_from(value).is_ok(),
    };
    if fits {
        Ok(())
    } else {
        Err(format!(
            "the immediate operand of '{mnemonic}' does not fit"
        ))
    }
}

/// Something in the output whose size can depend on where labels end up.
enum Item {
    Bytes(Vec<u8>),
    Label(u32),
    /// `jmp` (`None`) or `jCC` to the nearest label of that number in that direction.
    Branch {
        condition: Option<u8>,
        number: u32,
        forward: bool,
        long: bool,
    },
}

struct Statement<'a> {
    mnemonic: &'a str,
    operands: Vec<Operand>,
}

fn split_operands(text: &[u8]) -> Vec<&[u8]> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (at, &byte) in text.iter().enumerate() {
        match byte {
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                parts.push(&text[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    if !trim(&text[start..]).is_empty() || !parts.is_empty() {
        parts.push(&text[start..]);
    }
    parts
}

fn encode_statement(statement: &Statement, items: &mut Vec<Item>) -> Res<()> {
    let mnemonic = statement.mnemonic;
    let operands = &statement.operands;
    let mut out = Encoding::default();
    let wrong = || format!("'{mnemonic}' does not take these operands");
    let byte_registers = gprs_in(operands);

    // Instructions without operands, and the few with fixed ones.
    let fixed: Option<&[u8]> = match (mnemonic, operands.len()) {
        ("nop", 0) => Some(&[0x90]),
        ("pause", 0) => Some(&[0xf3, 0x90]),
        ("mfence", 0) => Some(&[0x0f, 0xae, 0xf0]),
        ("lfence", 0) => Some(&[0x0f, 0xae, 0xe8]),
        ("sfence", 0) => Some(&[0x0f, 0xae, 0xf8]),
        ("rdtsc", 0) => Some(&[0x0f, 0x31]),
        ("rdtscp", 0) => Some(&[0x0f, 0x01, 0xf9]),
        ("cpuid", 0) => Some(&[0x0f, 0xa2]),
        ("xgetbv", 0) => Some(&[0x0f, 0x01, 0xd0]),
        ("cld", 0) => Some(&[0xfc]),
        ("cbtw" | "cbw", 0) => Some(&[0x66, 0x98]),
        ("cwtl" | "cwde", 0) => Some(&[0x98]),
        ("cltq" | "cdqe", 0) => Some(&[0x48, 0x98]),
        ("cwtd" | "cwd", 0) => Some(&[0x66, 0x99]),
        ("cltd" | "cdq", 0) => Some(&[0x99]),
        ("cqto" | "cqo", 0) => Some(&[0x48, 0x99]),
        ("movsb", 0) => Some(&[0xa4]),
        ("movsw", 0) => Some(&[0x66, 0xa5]),
        ("movsl", 0) => Some(&[0xa5]),
        ("movsq", 0) => Some(&[0x48, 0xa5]),
        ("stosb", 0) => Some(&[0xaa]),
        ("stosw", 0) => Some(&[0x66, 0xab]),
        ("stosl", 0) => Some(&[0xab]),
        ("stosq", 0) => Some(&[0x48, 0xab]),
        ("lodsb", 0) => Some(&[0xac]),
        ("lodsw", 0) => Some(&[0x66, 0xad]),
        ("lodsl", 0) => Some(&[0xad]),
        ("lodsq", 0) => Some(&[0x48, 0xad]),
        ("scasb", 0) => Some(&[0xae]),
        ("scasw", 0) => Some(&[0x66, 0xaf]),
        ("scasl", 0) => Some(&[0xaf]),
        ("scasq", 0) => Some(&[0x48, 0xaf]),
        ("cmpsb", 0) => Some(&[0xa6]),
        ("cmpsw", 0) => Some(&[0x66, 0xa7]),
        ("cmpsl", 0) => Some(&[0xa7]),
        ("cmpsq", 0) => Some(&[0x48, 0xa7]),
        _ => None,
    };
    if let Some(bytes) = fixed {
        items.push(Item::Bytes(bytes.to_vec()));
        return Ok(());
    }
    if matches!(
        mnemonic,
        "push"
            | "pushq"
            | "pushl"
            | "pushw"
            | "pop"
            | "popq"
            | "popl"
            | "popw"
            | "pushf"
            | "pushfq"
            | "popf"
            | "popfq"
            | "call"
            | "callq"
            | "ret"
            | "retq"
            | "int"
            | "std"
            | "leave"
            | "enter"
            | "syscall"
            | "sysenter"
            | "hlt"
            | "iret"
            | "iretq"
    ) {
        return Err(format!(
            "'{mnemonic}' would disturb the stack frame or leave the statement, which the surrounding code cannot account for"
        ));
    }

    // Branches to local labels.
    let branch_condition = if matches!(mnemonic, "jmp" | "jmpq") {
        Some(None)
    } else {
        mnemonic
            .strip_prefix('j')
            .and_then(|condition| condition_code(condition.as_bytes()))
            .map(Some)
    };
    if let Some(condition) = branch_condition {
        return match operands.as_slice() {
            [Operand::Label { number, forward }] => {
                items.push(Item::Branch {
                    condition,
                    number: *number,
                    forward: *forward,
                    long: false,
                });
                Ok(())
            }
            _ => Err(format!(
                "'{mnemonic}' can only go to a numeric local label (1f, 1b)"
            )),
        };
    }

    // cmovCC and setCC.
    if let Some(condition) = mnemonic.strip_prefix("cmov") {
        let (condition, suffix) = match condition_code(condition.as_bytes()) {
            Some(code) => (Some(code), None),
            None => {
                let (head, tail) = condition.split_at(condition.len().saturating_sub(1));
                (
                    condition_code(head.as_bytes()),
                    tail.bytes().next().and_then(Size::from_suffix),
                )
            }
        };
        if let (Some(condition), [source, Operand::Gpr(destination)]) =
            (condition, operands.as_slice())
        {
            let size = suffix.unwrap_or(destination.size);
            if size == Size::B {
                return Err("cmov has no 8-bit form".to_string());
            }
            let rm = rm_of(source)
                .filter(|_| !matches!(source, Operand::Xmm(_)))
                .ok_or_else(wrong)?;
            out.emit(&Parts {
                prefixes: size_prefix(size),
                wide: size == Size::Q,
                byte_registers: &[],
                opcode: &[0x0f, 0x40 + condition],
                reg: destination.number,
                rm,
                immediate: None,
            })?;
            items.push(Item::Bytes(out.bytes));
            return Ok(());
        }
    }
    if let Some(condition) = mnemonic.strip_prefix("set") {
        let condition = condition_code(condition.as_bytes()).or_else(|| {
            condition
                .strip_suffix('b')
                .and_then(|head| condition_code(head.as_bytes()))
        });
        if let (Some(condition), [destination]) = (condition, operands.as_slice()) {
            let rm = match destination {
                Operand::Gpr(register) if register.size == Size::B => Rm::Register(register.number),
                Operand::Mem(memory) => Rm::Memory(*memory),
                _ => return Err(format!("'{mnemonic}' sets one byte")),
            };
            out.emit(&Parts {
                prefixes: &[],
                wide: false,
                byte_registers: &byte_registers,
                opcode: &[0x0f, 0x90 + condition],
                reg: 0,
                rm,
                immediate: None,
            })?;
            items.push(Item::Bytes(out.bytes));
            return Ok(());
        }
    }

    // Widening moves, whose two operands have different sizes.
    let widening: Option<(&[u8], Option<Size>, Option<Size>)> = match mnemonic {
        "movzbw" => Some((&[0x0f, 0xb6], Some(Size::B), Some(Size::W))),
        "movzbl" => Some((&[0x0f, 0xb6], Some(Size::B), Some(Size::L))),
        "movzbq" => Some((&[0x0f, 0xb6], Some(Size::B), Some(Size::Q))),
        "movzwl" => Some((&[0x0f, 0xb7], Some(Size::W), Some(Size::L))),
        "movzwq" => Some((&[0x0f, 0xb7], Some(Size::W), Some(Size::Q))),
        "movsbw" => Some((&[0x0f, 0xbe], Some(Size::B), Some(Size::W))),
        "movsbl" => Some((&[0x0f, 0xbe], Some(Size::B), Some(Size::L))),
        "movsbq" => Some((&[0x0f, 0xbe], Some(Size::B), Some(Size::Q))),
        "movswl" => Some((&[0x0f, 0xbf], Some(Size::W), Some(Size::L))),
        "movswq" => Some((&[0x0f, 0xbf], Some(Size::W), Some(Size::Q))),
        "movslq" | "movsxd" => Some((&[0x63], Some(Size::L), Some(Size::Q))),
        "movzx" | "movzb" | "movzw" | "movsx" | "movsb" | "movsw" => Some((&[], None, None)),
        _ => None,
    };
    if let Some((opcode, source_size, destination_size)) = widening {
        let [source, Operand::Gpr(destination)] = operands.as_slice() else {
            return Err(wrong());
        };
        let destination_size = destination_size.unwrap_or(destination.size);
        let source_size = match (source_size, source, mnemonic) {
            (Some(size), _, _) => size,
            (None, _, "movzb" | "movsb") => Size::B,
            (None, _, "movzw" | "movsw") => Size::W,
            (None, Operand::Gpr(register), _) => register.size,
            _ => {
                return Err(format!(
                    "'{mnemonic}' from memory needs the source size in its name (movzbl, movswq, ...)"
                ));
            }
        };
        let signed = mnemonic.starts_with("movs");
        let opcode: &[u8] = if !opcode.is_empty() {
            opcode
        } else {
            match (signed, source_size) {
                (false, Size::B) => &[0x0f, 0xb6],
                (false, Size::W) => &[0x0f, 0xb7],
                (true, Size::B) => &[0x0f, 0xbe],
                (true, Size::W) => &[0x0f, 0xbf],
                (true, Size::L) => &[0x63],
                _ => return Err(wrong()),
            }
        };
        if source_size.bytes() >= destination_size.bytes() {
            return Err(format!("'{mnemonic}' must widen"));
        }
        let rm = match source {
            Operand::Gpr(register) => Rm::Register(register.number),
            Operand::Mem(memory) => Rm::Memory(*memory),
            _ => return Err(wrong()),
        };
        let source_registers: Vec<Gpr> = gprs_in(std::slice::from_ref(source));
        out.emit(&Parts {
            prefixes: size_prefix(destination_size),
            wide: destination_size == Size::Q,
            byte_registers: &source_registers,
            opcode,
            reg: destination.number,
            rm,
            immediate: None,
        })?;
        items.push(Item::Bytes(out.bytes));
        return Ok(());
    }

    // SSE register moves and the common packed integer operations.
    if operands
        .iter()
        .any(|operand| matches!(operand, Operand::Xmm(_)))
        || matches!(mnemonic, "movdqa" | "movdqu" | "movaps" | "movups")
    {
        return encode_sse(mnemonic, operands, items);
    }

    // The BMI group: VEX-encoded, three operands.
    if let Some(done) = encode_bmi(mnemonic, operands, &mut out)? {
        if done {
            items.push(Item::Bytes(out.bytes));
            return Ok(());
        }
    }

    // Everything else is `name` + an optional size suffix.
    let (base, suffix) = {
        let known = |name: &str| {
            matches!(
                name,
                "add"
                    | "or"
                    | "adc"
                    | "sbb"
                    | "and"
                    | "sub"
                    | "xor"
                    | "cmp"
                    | "test"
                    | "mov"
                    | "movabs"
                    | "lea"
                    | "xchg"
                    | "xadd"
                    | "cmpxchg"
                    | "cmpxchg8b"
                    | "cmpxchg16b"
                    | "not"
                    | "neg"
                    | "mul"
                    | "imul"
                    | "div"
                    | "idiv"
                    | "inc"
                    | "dec"
                    | "rol"
                    | "ror"
                    | "rcl"
                    | "rcr"
                    | "shl"
                    | "sal"
                    | "shr"
                    | "sar"
                    | "shld"
                    | "shrd"
                    | "bt"
                    | "bts"
                    | "btr"
                    | "btc"
                    | "bsf"
                    | "bsr"
                    | "lzcnt"
                    | "tzcnt"
                    | "popcnt"
                    | "adcx"
                    | "adox"
                    | "bswap"
                    | "clflush"
                    | "clflushopt"
                    | "prefetcht0"
                    | "prefetcht1"
                    | "prefetcht2"
                    | "prefetchnta"
                    | "rdrand"
                    | "rdseed"
                    | "crc32"
            )
        };
        if known(mnemonic) {
            (mnemonic, None)
        } else {
            let (head, tail) = mnemonic.split_at(mnemonic.len().saturating_sub(1));
            match tail.bytes().next().and_then(Size::from_suffix) {
                Some(size) if known(head) => (head, Some(size)),
                _ => {
                    return Err(format!(
                        "inline assembly: unsupported instruction '{mnemonic}'"
                    ));
                }
            }
        }
    };

    let alu_index = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"]
        .iter()
        .position(|name| *name == base);
    if let Some(index) = alu_index {
        let index = index as u8;
        let [source, destination] = operands.as_slice() else {
            return Err(wrong());
        };
        let size = operation_size(suffix, operands, mnemonic)?;
        match (source, destination) {
            (Operand::Imm(value), destination) => {
                check_immediate(*value, size, mnemonic)?;
                let rm = rm_of(destination).ok_or_else(wrong)?;
                let (opcode, width) = if size == Size::B {
                    (0x80, 1)
                } else if i8::try_from(*value).is_ok() {
                    (0x83, 1)
                } else {
                    (0x81, if size == Size::W { 2 } else { 4 })
                };
                out.emit(&Parts {
                    prefixes: size_prefix(size),
                    wide: size == Size::Q,
                    byte_registers: &byte_registers,
                    opcode: &[opcode],
                    reg: index,
                    rm,
                    immediate: Some((*value, width)),
                })?;
            }
            (Operand::Gpr(source), destination) => {
                let rm = rm_of(destination).ok_or_else(wrong)?;
                out.emit(&Parts {
                    prefixes: size_prefix(size),
                    wide: size == Size::Q,
                    byte_registers: &byte_registers,
                    opcode: &[sized_opcode((index << 3) | 1, size)],
                    reg: source.number,
                    rm,
                    immediate: None,
                })?;
            }
            (Operand::Mem(source), Operand::Gpr(destination)) => {
                out.emit(&Parts {
                    prefixes: size_prefix(size),
                    wide: size == Size::Q,
                    byte_registers: &byte_registers,
                    opcode: &[sized_opcode((index << 3) | 3, size)],
                    reg: destination.number,
                    rm: Rm::Memory(*source),
                    immediate: None,
                })?;
            }
            _ => return Err(wrong()),
        }
        items.push(Item::Bytes(out.bytes));
        return Ok(());
    }

    let simple = |out: &mut Encoding,
                  prefixes: &[u8],
                  size: Size,
                  opcode: &[u8],
                  reg: u8,
                  rm: Rm,
                  immediate: Option<(i64, u8)>|
     -> Res<()> {
        let mut all = prefixes.to_vec();
        all.extend_from_slice(size_prefix(size));
        out.emit(&Parts {
            prefixes: &all,
            wide: size == Size::Q,
            byte_registers: &byte_registers,
            opcode,
            reg,
            rm,
            immediate,
        })
    };

    match (base, operands.as_slice()) {
        ("test", [Operand::Imm(value), destination]) => {
            let size = operation_size(suffix, operands, mnemonic)?;
            check_immediate(*value, size, mnemonic)?;
            let width = if size == Size::B {
                1
            } else if size == Size::W {
                2
            } else {
                4
            };
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0xf7, size)],
                0,
                rm_of(destination).ok_or_else(wrong)?,
                Some((*value, width)),
            )?;
        }
        ("test", [Operand::Gpr(source), destination]) => {
            let size = operation_size(suffix, operands, mnemonic)?;
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0x85, size)],
                source.number,
                rm_of(destination).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("mov" | "movabs", [Operand::Imm(value), Operand::Gpr(destination)]) => {
            let size = suffix.unwrap_or(destination.size);
            let fits32 = i32::try_from(*value).is_ok();
            if size == Size::Q && (base == "movabs" || !fits32) {
                out.emit_plus_register(&[], true, &[], 0xb8, *destination)?;
                out.immediate(*value, 8);
            } else if size == Size::Q {
                simple(
                    &mut out,
                    &[],
                    size,
                    &[0xc7],
                    0,
                    Rm::Register(destination.number),
                    Some((*value, 4)),
                )?;
            } else {
                check_immediate(*value, size, mnemonic)?;
                let opcode = if size == Size::B { 0xb0 } else { 0xb8 };
                out.emit_plus_register(
                    size_prefix(size),
                    false,
                    &byte_registers,
                    opcode,
                    *destination,
                )?;
                out.immediate(*value, size.bytes());
            }
        }
        ("mov", [Operand::Imm(value), Operand::Mem(destination)]) => {
            let size = operation_size(suffix, operands, mnemonic)?;
            check_immediate(*value, size, mnemonic)?;
            let width = if size == Size::B {
                1
            } else if size == Size::W {
                2
            } else {
                4
            };
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0xc7, size)],
                0,
                Rm::Memory(*destination),
                Some((*value, width)),
            )?;
        }
        (
            "mov",
            [
                Operand::Gpr(source),
                destination @ (Operand::Gpr(_) | Operand::Mem(_)),
            ],
        ) => {
            let size = suffix.unwrap_or(source.size);
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0x89, size)],
                source.number,
                rm_of(destination).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("mov", [Operand::Mem(source), Operand::Gpr(destination)]) => {
            let size = suffix.unwrap_or(destination.size);
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0x8b, size)],
                destination.number,
                Rm::Memory(*source),
                None,
            )?;
        }
        ("lea", [Operand::Mem(source), Operand::Gpr(destination)]) => {
            if source.segment.is_some() {
                return Err("lea ignores a segment override".to_string());
            }
            let size = suffix.unwrap_or(destination.size);
            simple(
                &mut out,
                &[],
                size,
                &[0x8d],
                destination.number,
                Rm::Memory(*source),
                None,
            )?;
        }
        ("xchg", [first, second]) => {
            let size = operation_size(suffix, operands, mnemonic)?;
            let (register, other) = match (first, second) {
                (Operand::Gpr(register), other) | (other, Operand::Gpr(register)) => {
                    (register, other)
                }
                _ => return Err(wrong()),
            };
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0x87, size)],
                register.number,
                rm_of(other).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("xadd", [Operand::Gpr(source), destination]) => {
            let size = operation_size(suffix, operands, mnemonic)?;
            simple(
                &mut out,
                &[],
                size,
                &[0x0f, sized_opcode(0xc1, size)],
                source.number,
                rm_of(destination).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("cmpxchg", [Operand::Gpr(source), destination]) => {
            let size = operation_size(suffix, operands, mnemonic)?;
            simple(
                &mut out,
                &[],
                size,
                &[0x0f, sized_opcode(0xb1, size)],
                source.number,
                rm_of(destination).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("cmpxchg8b", [Operand::Mem(destination)]) => simple(
            &mut out,
            &[],
            Size::L,
            &[0x0f, 0xc7],
            1,
            Rm::Memory(*destination),
            None,
        )?,
        ("cmpxchg16b", [Operand::Mem(destination)]) => simple(
            &mut out,
            &[],
            Size::Q,
            &[0x0f, 0xc7],
            1,
            Rm::Memory(*destination),
            None,
        )?,
        ("not" | "neg" | "mul" | "div" | "idiv", [operand]) | ("imul", [operand]) => {
            let extension = match base {
                "not" => 2,
                "neg" => 3,
                "mul" => 4,
                "imul" => 5,
                "div" => 6,
                _ => 7,
            };
            let size = operation_size(suffix, operands, mnemonic)?;
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0xf7, size)],
                extension,
                rm_of(operand).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("imul", [source, Operand::Gpr(destination)]) if !matches!(source, Operand::Imm(_)) => {
            let size = suffix.unwrap_or(destination.size);
            simple(
                &mut out,
                &[],
                size,
                &[0x0f, 0xaf],
                destination.number,
                rm_of(source).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("imul", [Operand::Imm(value), source, Operand::Gpr(destination)]) => {
            let size = suffix.unwrap_or(destination.size);
            check_immediate(*value, size, mnemonic)?;
            let (opcode, width) = if i8::try_from(*value).is_ok() {
                (0x6b, 1)
            } else {
                (0x69, if size == Size::W { 2 } else { 4 })
            };
            simple(
                &mut out,
                &[],
                size,
                &[opcode],
                destination.number,
                rm_of(source).ok_or_else(wrong)?,
                Some((*value, width)),
            )?;
        }
        ("imul", [Operand::Imm(value), Operand::Gpr(destination)]) => {
            let size = suffix.unwrap_or(destination.size);
            check_immediate(*value, size, mnemonic)?;
            let (opcode, width) = if i8::try_from(*value).is_ok() {
                (0x6b, 1)
            } else {
                (0x69, if size == Size::W { 2 } else { 4 })
            };
            simple(
                &mut out,
                &[],
                size,
                &[opcode],
                destination.number,
                Rm::Register(destination.number),
                Some((*value, width)),
            )?;
        }
        ("inc" | "dec", [operand]) => {
            let size = operation_size(suffix, operands, mnemonic)?;
            simple(
                &mut out,
                &[],
                size,
                &[sized_opcode(0xff, size)],
                u8::from(base == "dec"),
                rm_of(operand).ok_or_else(wrong)?,
                None,
            )?;
        }
        ("rol" | "ror" | "rcl" | "rcr" | "shl" | "sal" | "shr" | "sar", _) => {
            let extension = match base {
                "rol" => 0,
                "ror" => 1,
                "rcl" => 2,
                "rcr" => 3,
                "shl" | "sal" => 4,
                "shr" => 5,
                _ => 7,
            };
            let (count, destination) = match operands.as_slice() {
                [destination] => (None, destination),
                [count, destination] => (Some(count), destination),
                _ => return Err(wrong()),
            };
            let size = operation_size(suffix, std::slice::from_ref(destination), mnemonic)?;
            let rm = rm_of(destination).ok_or_else(wrong)?;
            match count {
                None | Some(Operand::Imm(1)) => simple(
                    &mut out,
                    &[],
                    size,
                    &[sized_opcode(0xd1, size)],
                    extension,
                    rm,
                    None,
                )?,
                Some(Operand::Imm(value)) => simple(
                    &mut out,
                    &[],
                    size,
                    &[sized_opcode(0xc1, size)],
                    extension,
                    rm,
                    Some((*value, 1)),
                )?,
                Some(Operand::Gpr(Gpr {
                    number: 1,
                    size: Size::B,
                    high: false,
                })) => simple(
                    &mut out,
                    &[],
                    size,
                    &[sized_opcode(0xd3, size)],
                    extension,
                    rm,
                    None,
                )?,
                _ => return Err(format!("'{mnemonic}' shifts by an immediate or by %cl")),
            }
        }
        ("shld" | "shrd", [count, Operand::Gpr(source), destination]) => {
            let size = suffix.unwrap_or(source.size);
            let opcode = if base == "shld" { 0xa4 } else { 0xac };
            let rm = rm_of(destination).ok_or_else(wrong)?;
            match count {
                Operand::Imm(value) => simple(
                    &mut out,
                    &[],
                    size,
                    &[0x0f, opcode],
                    source.number,
                    rm,
                    Some((*value, 1)),
                )?,
                Operand::Gpr(Gpr {
                    number: 1,
                    size: Size::B,
                    high: false,
                }) => simple(
                    &mut out,
                    &[],
                    size,
                    &[0x0f, opcode + 1],
                    source.number,
                    rm,
                    None,
                )?,
                _ => return Err(format!("'{mnemonic}' shifts by an immediate or by %cl")),
            }
        }
        ("bt" | "bts" | "btr" | "btc", [bit, destination]) => {
            let (opcode, extension) = match base {
                "bt" => (0xa3, 4),
                "bts" => (0xab, 5),
                "btr" => (0xb3, 6),
                _ => (0xbb, 7),
            };
            let rm = rm_of(destination).ok_or_else(wrong)?;
            match bit {
                Operand::Gpr(register) => simple(
                    &mut out,
                    &[],
                    suffix.unwrap_or(register.size),
                    &[0x0f, opcode],
                    register.number,
                    rm,
                    None,
                )?,
                Operand::Imm(value) => {
                    let size = operation_size(suffix, std::slice::from_ref(destination), mnemonic)?;
                    simple(
                        &mut out,
                        &[],
                        size,
                        &[0x0f, 0xba],
                        extension,
                        rm,
                        Some((*value, 1)),
                    )?;
                }
                _ => return Err(wrong()),
            }
        }
        ("bsf" | "bsr" | "tzcnt" | "lzcnt" | "popcnt", [source, Operand::Gpr(destination)]) => {
            let (prefix, opcode): (&[u8], u8) = match base {
                "bsf" => (&[], 0xbc),
                "bsr" => (&[], 0xbd),
                "tzcnt" => (&[0xf3], 0xbc),
                "lzcnt" => (&[0xf3], 0xbd),
                _ => (&[0xf3], 0xb8),
            };
            let size = suffix.unwrap_or(destination.size);
            // The operand-size prefix goes before the mandatory one.
            let mut prefixes = size_prefix(size).to_vec();
            prefixes.extend_from_slice(prefix);
            out.emit(&Parts {
                prefixes: &prefixes,
                wide: size == Size::Q,
                byte_registers: &[],
                opcode: &[0x0f, opcode],
                reg: destination.number,
                rm: rm_of(source).ok_or_else(wrong)?,
                immediate: None,
            })?;
        }
        ("adcx" | "adox", [source, Operand::Gpr(destination)]) => {
            let prefix = if base == "adcx" { 0x66 } else { 0xf3 };
            let size = suffix.unwrap_or(destination.size);
            out.emit(&Parts {
                prefixes: &[prefix],
                wide: size == Size::Q,
                byte_registers: &[],
                opcode: &[0x0f, 0x38, 0xf6],
                reg: destination.number,
                rm: rm_of(source).ok_or_else(wrong)?,
                immediate: None,
            })?;
        }
        ("bswap", [Operand::Gpr(register)]) => {
            let size = suffix.unwrap_or(register.size);
            if size != Size::L && size != Size::Q {
                return Err("bswap works on 32 and 64 bits".to_string());
            }
            out.emit_plus_register(&[0x0f], size == Size::Q, &[], 0xc8, *register)?;
        }
        ("clflush", [Operand::Mem(memory)]) => simple(
            &mut out,
            &[],
            Size::L,
            &[0x0f, 0xae],
            7,
            Rm::Memory(*memory),
            None,
        )?,
        ("clflushopt", [Operand::Mem(memory)]) => simple(
            &mut out,
            &[0x66],
            Size::L,
            &[0x0f, 0xae],
            7,
            Rm::Memory(*memory),
            None,
        )?,
        ("prefetcht0" | "prefetcht1" | "prefetcht2" | "prefetchnta", [Operand::Mem(memory)]) => {
            let extension = match base {
                "prefetchnta" => 0,
                "prefetcht0" => 1,
                "prefetcht1" => 2,
                _ => 3,
            };
            simple(
                &mut out,
                &[],
                Size::L,
                &[0x0f, 0x18],
                extension,
                Rm::Memory(*memory),
                None,
            )?;
        }
        ("rdrand" | "rdseed", [Operand::Gpr(register)]) => {
            let size = suffix.unwrap_or(register.size);
            simple(
                &mut out,
                &[],
                size,
                &[0x0f, 0xc7],
                if base == "rdrand" { 6 } else { 7 },
                Rm::Register(register.number),
                None,
            )?;
        }
        ("crc32", [source, Operand::Gpr(destination)]) => {
            let size = match (suffix, source) {
                (Some(size), _) => size,
                (None, Operand::Gpr(register)) => register.size,
                _ => return Err("crc32 from memory needs a size suffix".to_string()),
            };
            let mut prefixes = size_prefix(size).to_vec();
            prefixes.push(0xf2);
            out.emit(&Parts {
                prefixes: &prefixes,
                wide: size == Size::Q || destination.size == Size::Q,
                byte_registers: &byte_registers,
                opcode: &[0x0f, 0x38, if size == Size::B { 0xf0 } else { 0xf1 }],
                reg: destination.number,
                rm: rm_of(source).ok_or_else(wrong)?,
                immediate: None,
            })?;
        }
        _ => return Err(wrong()),
    }
    items.push(Item::Bytes(out.bytes));
    Ok(())
}

impl Encoding {
    /// An opcode with the register in its low three bits (`mov $imm, r`; `bswap r`).
    fn emit_plus_register(
        &mut self,
        leading: &[u8],
        wide: bool,
        byte_registers: &[Gpr],
        opcode: u8,
        register: Gpr,
    ) -> Res<()> {
        // `leading` is either operand-size prefixes (before REX) or the 0F escape (after it).
        let (before, after): (&[u8], &[u8]) = if leading == [0x0f] {
            (&[], leading)
        } else {
            (leading, &[])
        };
        self.bytes.extend_from_slice(before);
        let needs_rex_for_byte = byte_registers.iter().any(|candidate| {
            candidate.size == Size::B && !candidate.high && (4..8).contains(&candidate.number)
        });
        let rex = 0x40 | (u8::from(wide) << 3) | (register.number >> 3);
        if rex != 0x40 || needs_rex_for_byte {
            if register.high {
                return Err("%ah, %ch, %dh and %bh cannot be used here".to_string());
            }
            self.bytes.push(rex);
        }
        self.bytes.extend_from_slice(after);
        self.bytes.push(opcode + (register.number & 7));
        Ok(())
    }
}

/// `Ok(Some(true))` when `mnemonic` was one of the group and is now encoded.
fn encode_bmi(mnemonic: &str, operands: &[Operand], out: &mut Encoding) -> Res<Option<bool>> {
    let (base, suffix) = {
        let known = |name: &str| {
            matches!(
                name,
                "andn"
                    | "bextr"
                    | "bzhi"
                    | "blsi"
                    | "blsmsk"
                    | "blsr"
                    | "pdep"
                    | "pext"
                    | "mulx"
                    | "rorx"
                    | "sarx"
                    | "shlx"
                    | "shrx"
            )
        };
        if known(mnemonic) {
            (mnemonic, None)
        } else {
            let (head, tail) = mnemonic.split_at(mnemonic.len().saturating_sub(1));
            match tail.bytes().next().and_then(Size::from_suffix) {
                Some(size) if known(head) => (head, Some(size)),
                _ => return Ok(None),
            }
        }
    };
    let wrong = || format!("'{mnemonic}' does not take these operands");
    let general = |operand: &Operand| -> Res<Rm> {
        match operand {
            Operand::Gpr(register) => Ok(Rm::Register(register.number)),
            Operand::Mem(memory) => Ok(Rm::Memory(*memory)),
            _ => Err(wrong()),
        }
    };
    let width = |destination: &Gpr| -> Res<bool> {
        match suffix.unwrap_or(destination.size) {
            Size::Q => Ok(true),
            Size::L => Ok(false),
            _ => Err(format!("'{mnemonic}' works on 32 and 64 bits")),
        }
    };
    const MAP_0F38: u8 = 2;
    const MAP_0F3A: u8 = 3;
    const NONE: u8 = 0;
    const P66: u8 = 1;
    const PF3: u8 = 2;
    const PF2: u8 = 3;
    match (base, operands) {
        // name r/m, vvvv, destination
        (
            "andn" | "pdep" | "pext" | "mulx",
            [source, Operand::Gpr(second), Operand::Gpr(destination)],
        ) => {
            let (prefix, opcode) = match base {
                "andn" => (NONE, 0xf2),
                "pdep" => (PF2, 0xf5),
                "pext" => (PF3, 0xf5),
                _ => (PF2, 0xf6),
            };
            out.emit_vex(
                MAP_0F38,
                prefix,
                width(destination)?,
                opcode,
                destination.number,
                second.number,
                general(source)?,
                None,
            )?;
        }
        // name vvvv, r/m, destination
        (
            "bextr" | "bzhi" | "sarx" | "shlx" | "shrx",
            [Operand::Gpr(control), source, Operand::Gpr(destination)],
        ) => {
            let (prefix, opcode) = match base {
                "bextr" => (NONE, 0xf7),
                "bzhi" => (NONE, 0xf5),
                "sarx" => (PF3, 0xf7),
                "shlx" => (P66, 0xf7),
                _ => (PF2, 0xf7),
            };
            out.emit_vex(
                MAP_0F38,
                prefix,
                width(destination)?,
                opcode,
                destination.number,
                control.number,
                general(source)?,
                None,
            )?;
        }
        // name r/m, destination (in vvvv)
        ("blsi" | "blsmsk" | "blsr", [source, Operand::Gpr(destination)]) => {
            let extension = match base {
                "blsr" => 1,
                "blsmsk" => 2,
                _ => 3,
            };
            out.emit_vex(
                MAP_0F38,
                NONE,
                width(destination)?,
                0xf3,
                extension,
                destination.number,
                general(source)?,
                None,
            )?;
        }
        ("rorx", [Operand::Imm(count), source, Operand::Gpr(destination)]) => {
            out.emit_vex(
                MAP_0F3A,
                PF2,
                width(destination)?,
                0xf0,
                destination.number,
                0,
                general(source)?,
                Some(*count as u8),
            )?;
        }
        _ => return Err(wrong()),
    }
    Ok(Some(true))
}

fn encode_sse(mnemonic: &str, operands: &[Operand], items: &mut Vec<Item>) -> Res<()> {
    let wrong = || format!("'{mnemonic}' does not take these operands");
    let mut out = Encoding::default();
    let mut emit = |prefixes: &[u8],
                    wide: bool,
                    opcode: &[u8],
                    reg: u8,
                    rm: Rm,
                    immediate: Option<(i64, u8)>|
     -> Res<()> {
        out.emit(&Parts {
            prefixes,
            wide,
            byte_registers: &[],
            opcode,
            reg,
            rm,
            immediate,
        })
    };
    let xmm_or_memory = |operand: &Operand| -> Res<Rm> {
        match operand {
            Operand::Xmm(number) => Ok(Rm::Register(*number)),
            Operand::Mem(memory) => Ok(Rm::Memory(*memory)),
            _ => Err(wrong()),
        }
    };
    match (mnemonic, operands) {
        // Between a general register (or memory) and an xmm register.
        (
            "movd" | "movq",
            [
                source @ (Operand::Gpr(_) | Operand::Mem(_)),
                Operand::Xmm(destination),
            ],
        ) => {
            let wide =
                mnemonic == "movq" || matches!(source, Operand::Gpr(Gpr { size: Size::Q, .. }));
            match (source, wide) {
                // movq m64, xmm has its own, shorter, encoding.
                (Operand::Mem(memory), true) => emit(
                    &[0xf3],
                    false,
                    &[0x0f, 0x7e],
                    *destination,
                    Rm::Memory(*memory),
                    None,
                )?,
                _ => emit(
                    &[0x66],
                    wide,
                    &[0x0f, 0x6e],
                    *destination,
                    rm_of(source).ok_or_else(wrong)?,
                    None,
                )?,
            }
        }
        (
            "movd" | "movq",
            [
                Operand::Xmm(source),
                destination @ (Operand::Gpr(_) | Operand::Mem(_)),
            ],
        ) => {
            let wide = mnemonic == "movq"
                || matches!(destination, Operand::Gpr(Gpr { size: Size::Q, .. }));
            match (destination, wide) {
                (Operand::Mem(memory), true) => emit(
                    &[0x66],
                    false,
                    &[0x0f, 0xd6],
                    *source,
                    Rm::Memory(*memory),
                    None,
                )?,
                _ => emit(
                    &[0x66],
                    wide,
                    &[0x0f, 0x7e],
                    *source,
                    rm_of(destination).ok_or_else(wrong)?,
                    None,
                )?,
            }
        }
        ("movq", [Operand::Xmm(source), Operand::Xmm(destination)]) => emit(
            &[0xf3],
            false,
            &[0x0f, 0x7e],
            *destination,
            Rm::Register(*source),
            None,
        )?,
        ("movdqa" | "movdqu" | "movaps" | "movups", [source, destination]) => {
            let (prefix, load, store): (&[u8], u8, u8) = match mnemonic {
                "movdqa" => (&[0x66], 0x6f, 0x7f),
                "movdqu" => (&[0xf3], 0x6f, 0x7f),
                "movaps" => (&[], 0x28, 0x29),
                _ => (&[], 0x10, 0x11),
            };
            match (source, destination) {
                (source, Operand::Xmm(destination)) => emit(
                    prefix,
                    false,
                    &[0x0f, load],
                    *destination,
                    xmm_or_memory(source)?,
                    None,
                )?,
                (Operand::Xmm(source), Operand::Mem(destination)) => emit(
                    prefix,
                    false,
                    &[0x0f, store],
                    *source,
                    Rm::Memory(*destination),
                    None,
                )?,
                _ => return Err(wrong()),
            }
        }
        ("pmovmskb", [Operand::Xmm(source), Operand::Gpr(destination)]) => emit(
            &[0x66],
            false,
            &[0x0f, 0xd7],
            destination.number,
            Rm::Register(*source),
            None,
        )?,
        ("pshufd", [Operand::Imm(order), source, Operand::Xmm(destination)]) => emit(
            &[0x66],
            false,
            &[0x0f, 0x70],
            *destination,
            xmm_or_memory(source)?,
            Some((*order, 1)),
        )?,
        ("pclmulqdq", [Operand::Imm(which), source, Operand::Xmm(destination)]) => emit(
            &[0x66],
            false,
            &[0x0f, 0x3a, 0x44],
            *destination,
            xmm_or_memory(source)?,
            Some((*which, 1)),
        )?,
        ("pshufb", [source, Operand::Xmm(destination)]) => emit(
            &[0x66],
            false,
            &[0x0f, 0x38, 0x00],
            *destination,
            xmm_or_memory(source)?,
            None,
        )?,
        (_, [source, Operand::Xmm(destination)]) => {
            let opcode = match mnemonic {
                "pxor" => 0xef,
                "por" => 0xeb,
                "pand" => 0xdb,
                "pandn" => 0xdf,
                "paddb" => 0xfc,
                "paddw" => 0xfd,
                "paddd" => 0xfe,
                "paddq" => 0xd4,
                "psubb" => 0xf8,
                "psubw" => 0xf9,
                "psubd" => 0xfa,
                "psubq" => 0xfb,
                "pmullw" => 0xd5,
                "pcmpeqb" => 0x74,
                "pcmpeqw" => 0x75,
                "pcmpeqd" => 0x76,
                "punpcklbw" => 0x60,
                "punpcklwd" => 0x61,
                "punpckldq" => 0x62,
                "punpcklqdq" => 0x6c,
                "punpckhqdq" => 0x6d,
                _ => {
                    return Err(format!(
                        "inline assembly: unsupported instruction '{mnemonic}'"
                    ));
                }
            };
            emit(
                &[0x66],
                false,
                &[0x0f, opcode],
                *destination,
                xmm_or_memory(source)?,
                None,
            )?;
        }
        _ => {
            return Err(format!(
                "inline assembly: unsupported instruction '{mnemonic}'"
            ));
        }
    }
    items.push(Item::Bytes(out.bytes));
    Ok(())
}

/// The longest a statement's code may be (what the `InlineAsm` instruction allows).
pub(crate) const MAXIMUM_CODE_SIZE: usize = 4096;

/// Assembles `text`: statements separated by newlines or `;`, `#` starting a comment.
pub(crate) fn assemble(text: &[u8]) -> Res<Vec<u8>> {
    let mut items: Vec<Item> = Vec::new();
    let lowered: Vec<u8> = text.to_ascii_lowercase();
    for line in strings::split(&lowered, b"\n") {
        let line = match strings::index_of_char_usize(line, b'#') {
            Some(at) => &line[..at],
            None => line,
        };
        for statement in strings::split(line, b";") {
            let mut rest = trim(statement);
            // Labels, then prefixes, then at most one instruction.
            loop {
                let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
                if digits > 0 && rest.get(digits) == Some(&b':') {
                    let number = std::str::from_utf8(&rest[..digits])
                        .ok()
                        .and_then(|digits| digits.parse().ok())
                        .ok_or("a label number is too large")?;
                    items.push(Item::Label(number));
                    rest = trim(&rest[digits + 1..]);
                    continue;
                }
                break;
            }
            loop {
                let end = rest
                    .iter()
                    .position(u8::is_ascii_whitespace)
                    .unwrap_or(rest.len());
                let prefix = match &rest[..end] {
                    b"lock" => 0xf0,
                    b"rep" | b"repe" | b"repz" => 0xf3,
                    b"repne" | b"repnz" => 0xf2,
                    _ => break,
                };
                items.push(Item::Bytes(vec![prefix]));
                rest = trim(&rest[end..]);
            }
            if rest.is_empty() {
                continue;
            }
            let end = rest
                .iter()
                .position(u8::is_ascii_whitespace)
                .unwrap_or(rest.len());
            let mnemonic = std::str::from_utf8(&rest[..end])
                .map_err(|_| "an instruction name is not text".to_string())?;
            let arguments = trim(&rest[end..]);
            if mnemonic.starts_with('.') {
                match mnemonic {
                    // Where the code lands is not ours to choose.
                    ".p2align" | ".align" | ".balign" => continue,
                    ".byte" => {
                        let mut bytes = Vec::new();
                        for part in split_operands(arguments) {
                            let value = parse_integer(part)?;
                            if !(-128..=255).contains(&value) {
                                return Err("a .byte value does not fit in a byte".to_string());
                            }
                            bytes.push(value as u8);
                        }
                        items.push(Item::Bytes(bytes));
                        continue;
                    }
                    _ => {
                        return Err(format!(
                            "inline assembly: unsupported directive '{mnemonic}'"
                        ));
                    }
                }
            }
            let operands = split_operands(arguments)
                .into_iter()
                .map(parse_operand)
                .collect::<Res<Vec<_>>>()?;
            encode_statement(&Statement { mnemonic, operands }, &mut items)?;
        }
    }

    // Branches start short and grow until every displacement fits.
    loop {
        let mut offsets = Vec::with_capacity(items.len() + 1);
        let mut offset = 0usize;
        for item in &items {
            offsets.push(offset);
            offset += match item {
                Item::Bytes(bytes) => bytes.len(),
                Item::Label(_) => 0,
                Item::Branch {
                    condition, long, ..
                } => match (condition, long) {
                    (_, false) => 2,
                    (None, true) => 5,
                    (Some(_), true) => 6,
                },
            };
        }
        offsets.push(offset);
        if offset > MAXIMUM_CODE_SIZE {
            return Err(format!(
                "the statement assembles to more than {MAXIMUM_CODE_SIZE} bytes"
            ));
        }
        let target_of = |at: usize, number: u32, forward: bool| -> Res<usize> {
            let found = if forward {
                items[at + 1..]
                    .iter()
                    .position(|item| matches!(item, Item::Label(n) if *n == number))
                    .map(|distance| at + 1 + distance)
            } else {
                items[..at]
                    .iter()
                    .rposition(|item| matches!(item, Item::Label(n) if *n == number))
            };
            found.map(|index| offsets[index]).ok_or_else(|| {
                format!(
                    "there is no label {number} {} this branch",
                    if forward { "after" } else { "before" }
                )
            })
        };
        let mut grew = false;
        let mut code = Vec::with_capacity(offset);
        for at in 0..items.len() {
            match &items[at] {
                Item::Bytes(bytes) => code.extend_from_slice(bytes),
                Item::Label(_) => {}
                Item::Branch {
                    condition,
                    number,
                    forward,
                    long,
                } => {
                    let target = target_of(at, *number, *forward)? as i64;
                    let next = offsets[at + 1] as i64;
                    let displacement = target - next;
                    if !*long {
                        if let Ok(short) = i8::try_from(displacement) {
                            code.push(condition.map_or(0xeb, |code| 0x70 + code));
                            code.push(short as u8);
                        } else {
                            grew = true;
                            code.extend_from_slice(&[0, 0]);
                        }
                    } else {
                        match condition {
                            None => code.push(0xe9),
                            Some(condition) => code.extend_from_slice(&[0x0f, 0x80 + condition]),
                        }
                        code.extend_from_slice(&(displacement as i32).to_le_bytes());
                    }
                }
            }
        }
        if !grew {
            return Ok(code);
        }
        // Widen every branch that did not fit, then lay everything out again.
        let widen: Vec<usize> = (0..items.len())
            .filter(|&at| match &items[at] {
                Item::Branch {
                    number,
                    forward,
                    long: false,
                    ..
                } => target_of(at, *number, *forward).is_ok_and(|target| {
                    i8::try_from(target as i64 - offsets[at + 1] as i64).is_err()
                }),
                _ => false,
            })
            .collect();
        for at in widen {
            if let Item::Branch { long, .. } = &mut items[at] {
                *long = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::assemble;

    fn check(text: &str, expected: &[u8]) {
        match assemble(text.as_bytes()) {
            Ok(bytes) => assert_eq!(
                bytes, expected,
                "{text}: got {bytes:02x?}, expected {expected:02x?}"
            ),
            Err(message) => panic!("{text}: {message}"),
        }
    }

    #[test]
    fn integer_instructions() {
        check("cmp %esi, %edx", &[0x39, 0xf2]);
        check("cmova %rcx, %rax", &[0x48, 0x0f, 0x47, 0xc1]);
        check(
            "cmp %esi, %edx\n cmova %rcx, %rax",
            &[0x39, 0xf2, 0x48, 0x0f, 0x47, 0xc1],
        );
        check("mulq %rcx", &[0x48, 0xf7, 0xe1]);
        check("divq %r8", &[0x49, 0xf7, 0xf0]);
        check("testq %rax, %rax", &[0x48, 0x85, 0xc0]);
        check("addq $1, (%rdi)", &[0x48, 0x83, 0x07, 0x01]);
        check(
            "addl $0x12345678, %eax",
            &[0x81, 0xc0, 0x78, 0x56, 0x34, 0x12],
        );
        check("subq %rsi, %rdi", &[0x48, 0x29, 0xf7]);
        check("xorl (%rdi), %eax", &[0x33, 0x07]);
        check("andb $15, %cl", &[0x80, 0xe1, 0x0f]);
        check("adcq $0, %rdx", &[0x48, 0x83, 0xd2, 0x00]);
        check("negq %rax", &[0x48, 0xf7, 0xd8]);
        check("notl %edx", &[0xf7, 0xd2]);
        check("incl (%rax)", &[0xff, 0x00]);
        check("decl %ecx", &[0xff, 0xc9]);
        check("imulq %rsi, %rax", &[0x48, 0x0f, 0xaf, 0xc6]);
        check("imull $100, %esi, %eax", &[0x6b, 0xc6, 0x64]);
    }

    #[test]
    fn moves() {
        check("movl $5, %eax", &[0xb8, 0x05, 0x00, 0x00, 0x00]);
        check(
            "movq $-1, %rax",
            &[0x48, 0xc7, 0xc0, 0xff, 0xff, 0xff, 0xff],
        );
        check(
            "movabsq $0x1122334455667788, %rax",
            &[0x48, 0xb8, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11],
        );
        check("movq %rdi, %rax", &[0x48, 0x89, 0xf8]);
        check(
            "movq %fs:0, %rax",
            &[0x64, 0x48, 0x8b, 0x04, 0x25, 0x00, 0x00, 0x00, 0x00],
        );
        check(
            "movq %gs:0x30, %rax",
            &[0x65, 0x48, 0x8b, 0x04, 0x25, 0x30, 0x00, 0x00, 0x00],
        );
        check("movl %eax, 8(%rsp)", &[0x89, 0x44, 0x24, 0x08]);
        check("movq (%r12), %r13", &[0x4d, 0x8b, 0x2c, 0x24]);
        check("movq 0(%rbp), %rax", &[0x48, 0x8b, 0x45, 0x00]);
        check("movb %ah, %cl", &[0x88, 0xe1]);
        check("movb %sil, %al", &[0x40, 0x88, 0xf0]);
        check("movw $7, (%rdi)", &[0x66, 0xc7, 0x07, 0x07, 0x00]);
        check("movzbl (%rdi), %eax", &[0x0f, 0xb6, 0x07]);
        check("movzwl %cx, %eax", &[0x0f, 0xb7, 0xc1]);
        check("movsbq %dil, %rax", &[0x48, 0x0f, 0xbe, 0xc7]);
        check("movslq %esi, %rax", &[0x48, 0x63, 0xc6]);
        check("leaq 8(%rdi,%rsi,4), %rax", &[0x48, 0x8d, 0x44, 0xb7, 0x08]);
        check("leal (%rdi,%rdi,2), %eax", &[0x8d, 0x04, 0x7f]);
        check("xchgq %rax, (%rdi)", &[0x48, 0x87, 0x07]);
    }

    #[test]
    fn bits_and_shifts() {
        check("bswap %eax", &[0x0f, 0xc8]);
        check("bswapq %rdx", &[0x48, 0x0f, 0xca]);
        check("bswap %r9", &[0x49, 0x0f, 0xc9]);
        check("shlq $3, %rax", &[0x48, 0xc1, 0xe0, 0x03]);
        check("sarl %cl, %edx", &[0xd3, 0xfa]);
        check("shrq %rax", &[0x48, 0xd1, 0xe8]);
        check("rorq $13, %rax", &[0x48, 0xc1, 0xc8, 0x0d]);
        check("rolw $8, %ax", &[0x66, 0xc1, 0xc0, 0x08]);
        check("shldq $4, %rsi, %rax", &[0x48, 0x0f, 0xa4, 0xf0, 0x04]);
        check("shrdq %cl, %rdx, %rax", &[0x48, 0x0f, 0xad, 0xd0]);
        check("btq %rsi, (%rdi)", &[0x48, 0x0f, 0xa3, 0x37]);
        check("btsl $5, %eax", &[0x0f, 0xba, 0xe8, 0x05]);
        check("btrl %esi, (%rdi)", &[0x0f, 0xb3, 0x37]);
        check("bsrq %rdi, %rax", &[0x48, 0x0f, 0xbd, 0xc7]);
        check("bsfl %edi, %eax", &[0x0f, 0xbc, 0xc7]);
        check("tzcntl %edi, %eax", &[0xf3, 0x0f, 0xbc, 0xc7]);
        check("lzcntq %rdi, %rax", &[0xf3, 0x48, 0x0f, 0xbd, 0xc7]);
        check("popcntq %rdi, %rax", &[0xf3, 0x48, 0x0f, 0xb8, 0xc7]);
        check("setne %al", &[0x0f, 0x95, 0xc0]);
        check("sete %sil", &[0x40, 0x0f, 0x94, 0xc6]);
        check("setc (%rdi)", &[0x0f, 0x92, 0x07]);
        check("cmovnel %esi, %eax", &[0x0f, 0x45, 0xc6]);
        check("cmovbq (%rdi), %rax", &[0x48, 0x0f, 0x42, 0x07]);
    }

    #[test]
    fn atomics_and_system() {
        check(
            "lock cmpxchgq %rcx, (%rdi)",
            &[0xf0, 0x48, 0x0f, 0xb1, 0x0f],
        );
        check("lock; cmpxchgl %ecx, (%rdi)", &[0xf0, 0x0f, 0xb1, 0x0f]);
        check("lock xaddl %eax, (%rdx)", &[0xf0, 0x0f, 0xc1, 0x02]);
        check("lock cmpxchg16b (%rdi)", &[0xf0, 0x48, 0x0f, 0xc7, 0x0f]);
        check("lock incl (%rdi)", &[0xf0, 0xff, 0x07]);
        check("rdtsc", &[0x0f, 0x31]);
        check("rdtscp", &[0x0f, 0x01, 0xf9]);
        check("pause", &[0xf3, 0x90]);
        check("mfence", &[0x0f, 0xae, 0xf0]);
        check("cpuid", &[0x0f, 0xa2]);
        check("xgetbv", &[0x0f, 0x01, 0xd0]);
        check("rep movsb", &[0xf3, 0xa4]);
        check("rep stosq", &[0xf3, 0x48, 0xab]);
        check("clflush (%rdi)", &[0x0f, 0xae, 0x3f]);
        check("prefetcht0 64(%rsi)", &[0x0f, 0x18, 0x4e, 0x40]);
        check("rdrand %rax", &[0x48, 0x0f, 0xc7, 0xf0]);
        check("crc32q %rsi, %rax", &[0xf2, 0x48, 0x0f, 0x38, 0xf1, 0xc6]);
        check("crc32b %sil, %eax", &[0xf2, 0x40, 0x0f, 0x38, 0xf0, 0xc6]);
        check("crc32l (%rdi), %eax", &[0xf2, 0x0f, 0x38, 0xf1, 0x07]);
        check("adcxq %rsi, %rax", &[0x66, 0x48, 0x0f, 0x38, 0xf6, 0xc6]);
        check("adoxq %rsi, %rax", &[0xf3, 0x48, 0x0f, 0x38, 0xf6, 0xc6]);
        check(".byte 0x0f, 0x01, 0xd0", &[0x0f, 0x01, 0xd0]);
        check(".p2align 5", &[]);
    }

    #[test]
    fn bmi() {
        check("andn %rsi, %rdi, %rax", &[0xc4, 0xe2, 0xc0, 0xf2, 0xc6]);
        check("shlx %rcx, %rsi, %rax", &[0xc4, 0xe2, 0xf1, 0xf7, 0xc6]);
        check("shrxl %ecx, %esi, %eax", &[0xc4, 0xe2, 0x73, 0xf7, 0xc6]);
        check(
            "rorx $13, %rdi, %rax",
            &[0xc4, 0xe3, 0xfb, 0xf0, 0xc7, 0x0d],
        );
        check("mulx %rsi, %rax, %rdx", &[0xc4, 0xe2, 0xfb, 0xf6, 0xd6]);
        check("blsr %rdi, %rax", &[0xc4, 0xe2, 0xf8, 0xf3, 0xcf]);
        check("pdep %rsi, %rdi, %rax", &[0xc4, 0xe2, 0xc3, 0xf5, 0xc6]);
        check("pext %rsi, %rdi, %rax", &[0xc4, 0xe2, 0xc2, 0xf5, 0xc6]);
        check("bzhi %rdx, %rsi, %rax", &[0xc4, 0xe2, 0xe8, 0xf5, 0xc6]);
        check("andn %r9, %r10, %r11", &[0xc4, 0x42, 0xa8, 0xf2, 0xd9]);
    }

    #[test]
    fn sse() {
        check("movd %eax, %xmm0", &[0x66, 0x0f, 0x6e, 0xc0]);
        check("movq %rax, %xmm1", &[0x66, 0x48, 0x0f, 0x6e, 0xc8]);
        check("movq %xmm0, %rax", &[0x66, 0x48, 0x0f, 0x7e, 0xc0]);
        check("movdqu (%rdi), %xmm0", &[0xf3, 0x0f, 0x6f, 0x07]);
        check("movdqa %xmm1, (%rsi)", &[0x66, 0x0f, 0x7f, 0x0e]);
        check("pxor %xmm1, %xmm0", &[0x66, 0x0f, 0xef, 0xc1]);
        check(
            "pshufd $0x1b, %xmm1, %xmm0",
            &[0x66, 0x0f, 0x70, 0xc1, 0x1b],
        );
        check(
            "pclmulqdq $0x11, %xmm1, %xmm0",
            &[0x66, 0x0f, 0x3a, 0x44, 0xc1, 0x11],
        );
        check("pmovmskb %xmm0, %eax", &[0x66, 0x0f, 0xd7, 0xc0]);
        check("pxor %xmm9, %xmm8", &[0x66, 0x45, 0x0f, 0xef, 0xc1]);
    }

    #[test]
    fn branches() {
        check("1: decl %ecx\n jnz 1b", &[0xff, 0xc9, 0x75, 0xfc]);
        check(
            "testq %rax, %rax; je 2f; incq %rax; 2:",
            &[0x48, 0x85, 0xc0, 0x74, 0x03, 0x48, 0xff, 0xc0],
        );
        check("jmp 1f\n1:", &[0xeb, 0x00]);
        // A branch over more than 127 bytes grows to its 32-bit form.
        let mut text = String::from("jne 1f\n");
        for _ in 0..50 {
            text.push_str("addq $1, (%rdi)\n");
        }
        text.push_str("1:");
        let code = assemble(text.as_bytes()).unwrap();
        assert_eq!(&code[..6], &[0x0f, 0x85, 200, 0, 0, 0]);
        assert_eq!(code.len(), 6 + 200);
    }

    #[test]
    fn rejections() {
        for text in [
            "pushq %rax",
            "ret",
            "call 1f",
            "int $3",
            "movq foo(%rip), %rax",
            "frobnicate %rax",
            "jmp *%rax",
            "movq %rax",
            "addl $1, (%rdi,%rsp)",
            "movb %ah, %sil",
            "incl",
        ] {
            assert!(
                assemble(text.as_bytes()).is_err(),
                "{text} should be rejected"
            );
        }
        assert!(crate::tests::has(
            &assemble(b"add $1, (%rdi)").unwrap_err(),
            "size suffix"
        ));
        assert!(crate::tests::has(
            &assemble(b"jne 3f").unwrap_err(),
            "no label 3"
        ));
    }
}
