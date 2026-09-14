//! GCC extended `asm` statements: from constraints and a template to machine code with every
//! operand in a register of our choosing.
//!
//! This part knows nothing about expressions. It is given a description of each operand, picks a
//! register for it, prints the operands into the template, and has `x86_encode` assemble the
//! result. The caller puts the values in those registers (the `InlineAsm` instruction).

use crate::x86_encode;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ValueClass {
    Integer,
    Floating,
    Vector,
    /// An aggregate or anything else that only a memory constraint can take.
    Other,
}

#[derive(Clone, Debug)]
pub(crate) struct OperandInfo {
    /// `[name]`.
    pub(crate) name: Option<Vec<u8>>,
    pub(crate) constraint: Vec<u8>,
    pub(crate) class: ValueClass,
    /// In bytes.
    pub(crate) size: u64,
    /// The operand's value, when it is an integer constant expression.
    pub(crate) constant: Option<i64>,
    /// `register T x asm("rbx")`.
    pub(crate) pinned: Option<Vec<u8>>,
}

/// Where a value that has to be in a register before the code runs comes from.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Source {
    /// The value of input operand n.
    Input(usize),
    /// The current value of output operand n (`"+r"`).
    Output(usize),
    /// The address of input operand n (`"m"`).
    InputAddress(usize),
    /// The address of output operand n (`"=m"`, `"+m"`).
    OutputAddress(usize),
}

#[derive(Debug)]
pub(crate) struct Plan {
    pub(crate) code: Vec<u8>,
    /// Must not be removed or reordered with memory accesses.
    pub(crate) side_effects: bool,
    /// BIR register numbers: general 0..15, xmm 16..31.
    pub(crate) clobbers: Vec<u8>,
    pub(crate) inputs: Vec<(Source, u8)>,
    /// (output operand, register it is read from afterwards)
    pub(crate) outputs: Vec<(usize, u8)>,
}

type Res<T> = Result<T, String>;

/// The BIR number of a register named in a clobber list or an `asm("name")` label.
pub(crate) fn register_number(name: &[u8]) -> Option<u8> {
    let name = name.strip_prefix(b"%").unwrap_or(name);
    let name = std::str::from_utf8(name).ok()?.to_ascii_lowercase();
    if let Some(digits) = name.strip_prefix("xmm") {
        let number: u8 = digits.parse().ok()?;
        return (number < 16).then_some(16 + number);
    }
    const LEGACY: [[&str; 4]; 8] = [
        ["rax", "eax", "ax", "al"],
        ["rcx", "ecx", "cx", "cl"],
        ["rdx", "edx", "dx", "dl"],
        ["rbx", "ebx", "bx", "bl"],
        ["rsp", "esp", "sp", "spl"],
        ["rbp", "ebp", "bp", "bpl"],
        ["rsi", "esi", "si", "sil"],
        ["rdi", "edi", "di", "dil"],
    ];
    for (number, names) in LEGACY.iter().enumerate() {
        if names.contains(&name.as_str()) {
            return Some(number as u8);
        }
    }
    match name.as_str() {
        "ah" => return Some(0),
        "ch" => return Some(1),
        "dh" => return Some(2),
        "bh" => return Some(3),
        _ => {}
    }
    let rest = name.strip_prefix('r')?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let number: u8 = digits.parse().ok()?;
    let suffix = &rest[digits.len()..];
    ((8..16).contains(&number) && matches!(suffix, "" | "d" | "w" | "b" | "l")).then_some(number)
}

fn register_name(number: u8, bytes: u64) -> String {
    debug_assert!(number < 16);
    let number = usize::from(number);
    if number >= 8 {
        let suffix = match bytes {
            1 => "b",
            2 => "w",
            4 => "d",
            _ => "",
        };
        return format!("%r{number}{suffix}");
    }
    const NAMES: [[&str; 4]; 8] = [
        ["al", "ax", "eax", "rax"],
        ["cl", "cx", "ecx", "rcx"],
        ["dl", "dx", "edx", "rdx"],
        ["bl", "bx", "ebx", "rbx"],
        ["spl", "sp", "esp", "rsp"],
        ["bpl", "bp", "ebp", "rbp"],
        ["sil", "si", "esi", "rsi"],
        ["dil", "di", "edi", "rdi"],
    ];
    let column = match bytes {
        1 => 0,
        2 => 1,
        4 => 2,
        _ => 3,
    };
    format!("%{}", NAMES[number][column])
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    /// This general register.
    Specific(u8),
    /// Any general register from the pool.
    General {
        legacy_only: bool,
    },
    Xmm,
    Immediate(i64),
    /// Addressed through a general register.
    Memory,
    /// The register of output operand n.
    Matching(usize),
}

struct Classified {
    kind: Kind,
    /// `+`: read as well as written.
    in_out: bool,
    early_clobber: bool,
}

fn classify(operand: &OperandInfo, is_output: bool) -> Res<Classified> {
    let shown = || crate::token::display_bytes(&operand.constraint);
    let mut in_out = false;
    let mut early_clobber = false;
    let mut letters: Vec<u8> = Vec::new();
    for &byte in &operand.constraint {
        match byte {
            b'=' | b'%' | b' ' => {}
            b'+' => in_out = true,
            b'&' => early_clobber = true,
            // The first alternative is as good as any.
            b',' => break,
            _ => letters.push(byte),
        }
    }
    if in_out && !is_output {
        return Err(format!("the input constraint \"{}\" has a '+'", shown()));
    }
    if let Some(name) = &operand.pinned {
        let number = register_number(name)
            .ok_or_else(|| format!("'{}' is not a register", crate::token::display_bytes(name)))?;
        let kind = if number >= 16 {
            Kind::Xmm
        } else {
            Kind::Specific(number)
        };
        if number >= 16 {
            return Err(
                "a variable pinned to an xmm register cannot be an asm operand yet".to_string(),
            );
        }
        return Ok(Classified {
            kind,
            in_out,
            early_clobber,
        });
    }
    if let [digit @ b'0'..=b'9'] = letters.as_slice() {
        if is_output {
            return Err(format!(
                "the output constraint \"{}\" refers to another operand",
                shown()
            ));
        }
        return Ok(Classified {
            kind: Kind::Matching(usize::from(digit - b'0')),
            in_out,
            early_clobber,
        });
    }
    let has = |set: &[u8]| letters.iter().any(|letter| set.contains(letter));
    if has(b"Aftu") {
        return Err(format!(
            "the constraint \"{}\" names x87 registers or a register pair, which are not supported",
            shown()
        ));
    }
    let integer = operand.class == ValueClass::Integer;
    if !is_output && has(b"ineIJKLMNOZs") {
        if let Some(value) = operand.constant {
            return Ok(Classified {
                kind: Kind::Immediate(value),
                in_out,
                early_clobber,
            });
        }
    }
    for (letter, number) in [
        (b'a', 0u8),
        (b'c', 1),
        (b'd', 2),
        (b'b', 3),
        (b'S', 6),
        (b'D', 7),
    ] {
        if letters.contains(&letter) {
            if !integer {
                return Err(format!(
                    "the constraint \"{}\" puts a value that is not an integer or a pointer in a general register",
                    shown()
                ));
            }
            return Ok(Classified {
                kind: Kind::Specific(number),
                in_out,
                early_clobber,
            });
        }
    }
    // `q` is any register that has a byte form, which in 64-bit code is all of them.
    if integer && has(b"rlRgpXq") {
        return Ok(Classified {
            kind: Kind::General { legacy_only: false },
            in_out,
            early_clobber,
        });
    }
    // `Q` is the four whose second byte has a name too (%ah, %bh, %ch, %dh).
    if integer && has(b"Q") {
        return Ok(Classified {
            kind: Kind::General { legacy_only: true },
            in_out,
            early_clobber,
        });
    }
    if matches!(operand.class, ValueClass::Floating | ValueClass::Vector) && has(b"xvY") {
        return Ok(Classified {
            kind: Kind::Xmm,
            in_out,
            early_clobber,
        });
    }
    if has(b"moVgX") {
        return Ok(Classified {
            kind: Kind::Memory,
            in_out,
            early_clobber,
        });
    }
    if has(b"ineIJKLMNOZs") {
        return Err(format!(
            "the operand for the constraint \"{}\" is not a constant",
            shown()
        ));
    }
    Err(format!(
        "the constraint \"{}\" is not supported for this operand",
        shown()
    ))
}

/// Where an operand ended up, for printing it into the template.
#[derive(Clone, Copy, Debug)]
enum Placed {
    General(u8),
    Xmm(u8),
    Immediate(i64),
    /// The address is in this general register.
    Memory(u8),
}

struct Registers {
    taken: [bool; 32],
}

impl Registers {
    fn take_general(&mut self, legacy_only: bool) -> Res<u8> {
        // Caller-saved first; the callee-saved ones cost the function a save and a restore.
        const POOL: [u8; 14] = [0, 1, 2, 6, 7, 8, 9, 10, 11, 3, 12, 13, 14, 15];
        const LEGACY: [u8; 4] = [0, 1, 2, 3];
        let pool: &[u8] = if legacy_only { &LEGACY } else { &POOL };
        for &number in pool {
            if !self.taken[usize::from(number)] {
                self.taken[usize::from(number)] = true;
                return Ok(number);
            }
        }
        Err("the asm statement needs more general registers than there are".to_string())
    }

    fn take_xmm(&mut self) -> Res<u8> {
        for number in 16..32u8 {
            if !self.taken[usize::from(number)] {
                self.taken[usize::from(number)] = true;
                return Ok(number);
            }
        }
        Err("the asm statement needs more xmm registers than there are".to_string())
    }
}

/// Chooses registers, prints the operands into `template` and assembles it.
///
/// `unique` is what `%=` prints: a number no other asm statement in the unit has.
pub(crate) fn plan(
    template: &[u8],
    outputs: &[OperandInfo],
    inputs: &[OperandInfo],
    clobbers: &[Vec<u8>],
    is_volatile: bool,
    unique: u32,
) -> Res<Plan> {
    if outputs.len() + inputs.len() > 30 {
        return Err("an asm statement can have at most 30 operands".to_string());
    }
    let mut side_effects = is_volatile || outputs.is_empty();
    let mut clobbered: Vec<u8> = Vec::new();
    for clobber in clobbers {
        let name = crate::token::display_bytes(clobber).to_ascii_lowercase();
        match name.as_str() {
            "memory" => side_effects = true,
            "cc" | "flags" | "fpsr" | "dirflag" | "" => {}
            name if name.starts_with("st") || name.starts_with("mm") => {}
            _ => match register_number(clobber) {
                // The stack and frame pointers are never handed out anyway.
                Some(4 | 5) => {}
                Some(number) => {
                    if !clobbered.contains(&number) {
                        clobbered.push(number);
                    }
                }
                None => return Err(format!("'{name}' in the clobber list is not a register")),
            },
        }
    }

    let output_kinds = outputs
        .iter()
        .map(|operand| classify(operand, true))
        .collect::<Res<Vec<_>>>()?;
    let input_kinds = inputs
        .iter()
        .map(|operand| classify(operand, false))
        .collect::<Res<Vec<_>>>()?;

    let mut registers = Registers { taken: [false; 32] };
    registers.taken[4] = true;
    registers.taken[5] = true;
    for &number in &clobbered {
        registers.taken[usize::from(number)] = true;
    }

    // Operands that name their register come first, so the free choice avoids them. An input and
    // an output may name the same register (the input is read before the output is written);
    // two on the same side may not.
    let mut output_places: Vec<Option<Placed>> = vec![None; outputs.len()];
    let mut input_places: Vec<Option<Placed>> = vec![None; inputs.len()];
    let mut specific_outputs = [false; 16];
    let mut specific_inputs = [false; 16];
    for (at, classified) in output_kinds.iter().enumerate() {
        if let Kind::Specific(number) = classified.kind {
            if clobbered.contains(&number) {
                return Err(format!(
                    "{} is both an operand and clobbered",
                    register_name(number, 8)
                ));
            }
            if std::mem::replace(&mut specific_outputs[usize::from(number)], true) {
                return Err(format!("two outputs are in {}", register_name(number, 8)));
            }
            output_places[at] = Some(Placed::General(number));
        }
    }
    for (at, classified) in input_kinds.iter().enumerate() {
        if let Kind::Specific(number) = classified.kind {
            if clobbered.contains(&number) {
                return Err(format!(
                    "{} is both an operand and clobbered",
                    register_name(number, 8)
                ));
            }
            if std::mem::replace(&mut specific_inputs[usize::from(number)], true) {
                return Err(format!("two inputs are in {}", register_name(number, 8)));
            }
            // Shared with an output only when that output is not read too and not written early.
            if specific_outputs[usize::from(number)] {
                let sharer = output_kinds
                    .iter()
                    .find(|output| output.kind == Kind::Specific(number));
                if sharer.is_some_and(|output| output.in_out || output.early_clobber) {
                    return Err(format!(
                        "an input and a '+' or '&' output are both in {}",
                        register_name(number, 8)
                    ));
                }
            }
            input_places[at] = Some(Placed::General(number));
        }
    }
    for number in 0..16 {
        if specific_outputs[number] || specific_inputs[number] {
            registers.taken[number] = true;
        }
    }
    for (at, classified) in output_kinds.iter().enumerate() {
        output_places[at] = Some(match classified.kind {
            Kind::Specific(_) => continue,
            Kind::General { legacy_only } => Placed::General(registers.take_general(legacy_only)?),
            Kind::Xmm => Placed::Xmm(registers.take_xmm()?),
            Kind::Memory => Placed::Memory(registers.take_general(false)?),
            Kind::Immediate(_) | Kind::Matching(_) => {
                return Err("an output cannot be an immediate".to_string());
            }
        });
    }
    let mut matched_outputs = vec![false; outputs.len()];
    for (at, classified) in input_kinds.iter().enumerate() {
        input_places[at] = Some(match classified.kind {
            Kind::Specific(_) => continue,
            Kind::General { legacy_only } => Placed::General(registers.take_general(legacy_only)?),
            Kind::Xmm => Placed::Xmm(registers.take_xmm()?),
            Kind::Memory => Placed::Memory(registers.take_general(false)?),
            Kind::Immediate(value) => Placed::Immediate(value),
            Kind::Matching(output) => {
                let place = output_places
                    .get(output)
                    .copied()
                    .flatten()
                    .ok_or_else(|| {
                        format!(
                            "the constraint \"{output}\" names an operand that is not an output"
                        )
                    })?;
                if !matches!(place, Placed::General(_) | Placed::Xmm(_)) {
                    return Err(format!(
                        "the constraint \"{output}\" names an output that is not in a register"
                    ));
                }
                if output_kinds[output].in_out
                    || std::mem::replace(&mut matched_outputs[output], true)
                {
                    return Err(format!("output {output} already has an input value"));
                }
                place
            }
        });
    }

    let mut plan_inputs: Vec<(Source, u8)> = Vec::new();
    let mut plan_outputs: Vec<(usize, u8)> = Vec::new();
    for (at, (classified, place)) in output_kinds.iter().zip(&output_places).enumerate() {
        match place.expect("every output was placed") {
            Placed::General(number) => {
                plan_outputs.push((at, number));
                if classified.in_out {
                    plan_inputs.push((Source::Output(at), number));
                }
            }
            Placed::Xmm(number) => {
                plan_outputs.push((at, number));
                if classified.in_out {
                    plan_inputs.push((Source::Output(at), number));
                }
            }
            Placed::Memory(number) => {
                plan_inputs.push((Source::OutputAddress(at), number));
                side_effects = true;
            }
            Placed::Immediate(_) => unreachable!("an output is never an immediate"),
        }
    }
    for (at, place) in input_places.iter().enumerate() {
        match place.expect("every input was placed") {
            Placed::General(number) | Placed::Xmm(number) => {
                plan_inputs.push((Source::Input(at), number))
            }
            Placed::Memory(number) => plan_inputs.push((Source::InputAddress(at), number)),
            Placed::Immediate(_) => {}
        }
    }
    for (index, (_, register)) in plan_inputs.iter().enumerate() {
        if plan_inputs[..index]
            .iter()
            .any(|(_, earlier)| earlier == register)
        {
            return Err(format!(
                "two values have to be in {} when the asm statement starts",
                if *register < 16 {
                    register_name(*register, 8)
                } else {
                    format!("%xmm{}", register - 16)
                }
            ));
        }
    }
    if plan_inputs.len() > 16 || plan_outputs.len() > 16 {
        return Err(
            "an asm statement can have at most 16 register inputs and 16 register outputs"
                .to_string(),
        );
    }

    // Print the operands into the template.
    let operand_count = outputs.len() + inputs.len();
    let info = |index: usize| -> (&OperandInfo, Placed) {
        if index < outputs.len() {
            (&outputs[index], output_places[index].expect("placed"))
        } else {
            (
                &inputs[index - outputs.len()],
                input_places[index - outputs.len()].expect("placed"),
            )
        }
    };
    let find_named = |name: &[u8]| -> Option<usize> {
        outputs
            .iter()
            .chain(inputs.iter())
            .position(|operand| operand.name.as_deref() == Some(name))
    };
    let mut text: Vec<u8> = Vec::with_capacity(template.len() + 16);
    let mut at = 0;
    // Inside `{att|intel}`: 0 = outside, 1 = in the AT&T alternative, 2 = in a later one.
    let mut alternative = 0u8;
    while at < template.len() {
        let byte = template[at];
        at += 1;
        match byte {
            b'{' => alternative = 1,
            b'|' if alternative != 0 => alternative = 2,
            b'}' if alternative != 0 => alternative = 0,
            _ if alternative == 2 => {}
            b'%' => {
                let Some(&next) = template.get(at) else {
                    return Err("the asm template ends in '%'".to_string());
                };
                if matches!(next, b'%' | b'{' | b'|' | b'}') {
                    text.push(next);
                    at += 1;
                    continue;
                }
                if next == b'=' {
                    text.extend_from_slice(unique.to_string().as_bytes());
                    at += 1;
                    continue;
                }
                let mut modifier = None;
                if next.is_ascii_alphabetic()
                    && template
                        .get(at + 1)
                        .is_some_and(|after| after.is_ascii_digit() || *after == b'[')
                {
                    modifier = Some(next);
                    at += 1;
                }
                let index = if template.get(at) == Some(&b'[') {
                    let mut close = 0;
                    while template.get(at + close).is_some_and(|byte| *byte != b']') {
                        close += 1;
                    }
                    if at + close >= template.len() {
                        return Err("the asm template has an unclosed '%['".to_string());
                    }
                    let name = &template[at + 1..at + close];
                    at += close + 1;
                    find_named(name).ok_or_else(|| {
                        format!(
                            "the asm template names an operand '{}' that does not exist",
                            crate::token::display_bytes(name)
                        )
                    })?
                } else {
                    let digits = template[at..]
                        .iter()
                        .take_while(|byte| byte.is_ascii_digit())
                        .count();
                    if digits == 0 {
                        return Err(format!(
                            "the asm template has a '%' followed by '{}'",
                            char::from(next)
                        ));
                    }
                    let index: usize = std::str::from_utf8(&template[at..at + digits])
                        .ok()
                        .and_then(|digits| digits.parse().ok())
                        .ok_or("an operand number in the asm template is too large")?;
                    at += digits;
                    index
                };
                if index >= operand_count {
                    return Err(format!(
                        "the asm template uses operand {index}, but there are only {operand_count}"
                    ));
                }
                let (operand, place) = info(index);
                let printed = match (place, modifier) {
                    (Placed::General(number), None) => {
                        register_name(number, operand.size.clamp(1, 8).next_power_of_two())
                    }
                    (Placed::General(number), Some(b'b')) => register_name(number, 1),
                    (Placed::General(number), Some(b'w')) => register_name(number, 2),
                    (Placed::General(number), Some(b'k')) => register_name(number, 4),
                    (Placed::General(number), Some(b'q')) => register_name(number, 8),
                    (Placed::General(number), Some(b'a')) => {
                        format!("({})", register_name(number, 8))
                    }
                    (Placed::General(number), Some(b'h')) => match number {
                        0 => "%ah".to_string(),
                        1 => "%ch".to_string(),
                        2 => "%dh".to_string(),
                        3 => "%bh".to_string(),
                        _ => {
                            return Err(
                                "the 'h' operand modifier needs the operand in a, b, c or d"
                                    .to_string(),
                            );
                        }
                    },
                    (Placed::Xmm(number), None | Some(b'x')) => format!("%xmm{}", number - 16),
                    (Placed::Immediate(value), None) => format!("${value}"),
                    (Placed::Immediate(value), Some(b'c' | b'P' | b'p')) => value.to_string(),
                    (Placed::Immediate(value), Some(b'n')) => value.wrapping_neg().to_string(),
                    (Placed::Memory(number), None | Some(b'P' | b'p')) => {
                        format!("({})", register_name(number, 8))
                    }
                    (_, Some(modifier)) => {
                        return Err(format!(
                            "the operand modifier '{}' is not supported here",
                            char::from(modifier)
                        ));
                    }
                };
                text.extend_from_slice(printed.as_bytes());
            }
            _ => text.push(byte),
        }
    }
    let code = x86_encode::assemble(&text)?;
    Ok(Plan {
        code,
        side_effects,
        clobbers: clobbered,
        inputs: plan_inputs,
        outputs: plan_outputs,
    })
}
