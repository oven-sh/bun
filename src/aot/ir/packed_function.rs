use super::generated::{
    Body, DeclaredCapture, DeclaredType, Function, FunctionFlags, FunctionKind, FunctionRole,
    FunctionSyntax, PositionFlags, SourceRange,
};
use super::ids::optional_id_to_word;
use super::packed_body::pack_words;
use super::packed_layout::{PackScratch, WordReader, count_of};
use std::sync::Arc;

#[derive(Clone)]
pub enum PackedFunction {
    Packed(Box<[u32]>),
    Whole(Arc<Function>),
}

const PARAMETERS: usize = 0;
const BODY_AT: usize = 1;
const PLAIN_WORDS: usize = 2;

fn push_type(declared: DeclaredType, words: &mut Vec<u32>) {
    let DeclaredType { ty, site, flags } = declared;
    words.extend([ty.to_word(), optional_id_to_word(site), flags.0]);
}

fn read_type(words: &mut WordReader<'_>) -> DeclaredType {
    DeclaredType {
        ty: words.next_id(),
        site: words.next_optional_id(),
        flags: PositionFlags::from_wire(words.next()).expect("a packed type has its flags"),
    }
}

fn push_capture(capture: &DeclaredCapture, words: &mut Vec<u32>) {
    let DeclaredCapture {
        ty,
        site,
        flags,
        variable_name,
    } = *capture;
    push_type(DeclaredType { ty, site, flags }, words);
    words.push(optional_id_to_word(variable_name));
}

fn read_capture(words: &mut WordReader<'_>) -> DeclaredCapture {
    let DeclaredType { ty, site, flags } = read_type(words);
    DeclaredCapture {
        ty,
        site,
        flags,
        variable_name: words.next_optional_id(),
    }
}

impl PackedFunction {
    pub fn new(function: Arc<Function>, scratch: &mut PackScratch) -> PackedFunction {
        match Arc::try_unwrap(function) {
            Ok(mut function) => {
                function.body.pack(&mut scratch.bytes);
                match has_unpacked_part(&function) {
                    true => PackedFunction::Whole(Arc::new(function)),
                    false => PackedFunction::Packed(pack(function, scratch)),
                }
            }
            Err(shared) => PackedFunction::Whole(shared),
        }
    }

    pub fn has_parameters(&self) -> bool {
        match self {
            PackedFunction::Packed(words) => words[PARAMETERS] != 0,
            PackedFunction::Whole(function) => !function.parameters.is_empty(),
        }
    }

    pub fn unpack(self, scratch: &mut PackScratch) -> Arc<Function> {
        match self {
            PackedFunction::Packed(words) => Arc::new(unpack(&words, scratch)),
            PackedFunction::Whole(function) => function,
        }
    }
}

fn has_unpacked_part(function: &Function) -> bool {
    function.enclosing_runtime_function.is_some()
        || !function.function_types.is_empty()
        || !function.builtin_members.is_empty()
}

fn pack(function: Function, scratch: &mut PackScratch) -> Box<[u32]> {
    let Function {
        name,
        module,
        position,
        source_range: SourceRange { start, end },
        kind,
        role,
        flags,
        length,
        syntax,
        enclosing_runtime_function: _,
        captures,
        this_type,
        parameters,
        results,
        body: Body {
            code,
            block_count,
            value_count,
        },
        function_types: _,
        builtin_members: _,
        requested_originals,
    } = function;
    let words = &mut scratch.words;
    words.clear();
    words.extend([
        optional_id_to_word(name),
        module.to_word(),
        position,
        start.wrapping_sub(position),
        end.wrapping_sub(start),
        kind.to_wire(),
        role.to_wire(),
        flags.to_wire(),
        length,
        syntax.to_wire(),
        block_count,
        value_count,
        count_of(&captures),
        count_of(&parameters),
        count_of(&results),
        count_of(&requested_originals),
    ]);
    push_type(this_type, words);
    for capture in &captures {
        push_capture(capture, words);
    }
    for &declared in parameters.iter().chain(&results) {
        push_type(declared, words);
    }
    words.extend(requested_originals.iter().map(|id| id.to_word()));
    let record = pack_words(&[], words, &mut scratch.bytes);
    let body_at = PLAIN_WORDS + record.len();
    let mut packed = Vec::with_capacity(body_at + code.len());
    packed.extend([
        count_of(&parameters),
        count_of(&record) + PLAIN_WORDS as u32,
    ]);
    packed.extend_from_slice(&record);
    packed.extend_from_slice(&code);
    packed.into_boxed_slice()
}

fn unpack(packed: &[u32], scratch: &mut PackScratch) -> Function {
    let (record, code) = packed.split_at(packed[BODY_AT] as usize);
    let mut words = scratch.unpack(&record[PLAIN_WORDS..]);
    let words = &mut words;
    let (name, module, position) = (words.next_optional_id(), words.next_id(), words.next());
    let start = position.wrapping_add(words.next());
    let end = start.wrapping_add(words.next());
    let kind = FunctionKind::from_wire(words.next()).expect("a packed function has a kind");
    let role = FunctionRole::from_wire(words.next()).expect("a packed function has a role");
    let flags = FunctionFlags::from_wire(words.next()).expect("a packed function has its flags");
    let length = words.next();
    let syntax = FunctionSyntax::from_wire(words.next()).expect("a packed function has its syntax");
    let (block_count, value_count) = (words.next(), words.next());
    let [captures, parameters, results, requested_originals] =
        core::array::from_fn(|_| words.next());
    Function {
        name,
        module,
        position,
        source_range: SourceRange { start, end },
        kind,
        role,
        flags,
        length,
        syntax,
        enclosing_runtime_function: None,
        this_type: read_type(words),
        captures: words.next_list(captures, read_capture),
        parameters: words.next_list(parameters, read_type),
        results: words.next_list(results, read_type),
        body: Body {
            code: code.to_vec(),
            block_count,
            value_count,
        },
        function_types: Vec::new(),
        builtin_members: Vec::new(),
        requested_originals: words.next_list(requested_originals, WordReader::next_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{ModuleId, StringId, TypeId, TypeSiteId};

    const NUMBERS: [u32; 6] = [0, 3, 0x7F, 0xFFFF, 0x1_0000, 0x00FF_FFFF];

    fn declared(number: usize) -> DeclaredType {
        DeclaredType {
            ty: TypeId::from_word(NUMBERS[number % NUMBERS.len()]),
            site: (number % 3 == 0).then(|| TypeSiteId::from_word(number as u32)),
            flags: PositionFlags(number as u32 & PositionFlags::ALL.0),
        }
    }

    fn function(number: usize) -> Function {
        let at = |place: usize| NUMBERS[(number + place) % NUMBERS.len()];
        let string = |place: usize| StringId::from_word(at(place));
        Function {
            name: (number % 2 == 0).then(|| string(0)),
            module: ModuleId::from_word(at(1)),
            position: at(2),
            source_range: SourceRange {
                start: at(3),
                end: at(4),
            },
            kind: FunctionKind::from_wire(number as u32 % 3).unwrap(),
            role: FunctionRole::from_wire(number as u32 % 4).unwrap(),
            flags: FunctionFlags(at(5) & FunctionFlags::ALL.0),
            length: number as u32,
            syntax: FunctionSyntax(at(0) & FunctionSyntax::ALL.0),
            enclosing_runtime_function: None,
            captures: (0..number % 4)
                .map(|place| DeclaredCapture {
                    ty: declared(place).ty,
                    site: declared(place).site,
                    flags: declared(place).flags,
                    variable_name: (place % 2 == 0).then(|| string(place)),
                })
                .collect(),
            this_type: declared(number),
            parameters: (0..number % 5).map(declared).collect(),
            results: (0..number % 3).map(declared).collect(),
            body: Body {
                code: (0..number as u32 * 5).collect(),
                block_count: at(1),
                value_count: at(2),
            },
            function_types: Vec::new(),
            builtin_members: Vec::new(),
            requested_originals: (0..number % 2).map(string).collect(),
        }
    }

    #[test]
    fn packed_functions_round_trip() {
        let mut scratch = PackScratch::default();
        for number in 0..60 {
            let expected = function(number);
            let packed = PackedFunction::new(Arc::new(expected.clone()), &mut scratch);
            assert!(matches!(packed, PackedFunction::Packed(_)));
            assert_eq!(packed.has_parameters(), !expected.parameters.is_empty());
            let mut unpacked = Arc::unwrap_or_clone(packed.unpack(&mut scratch));
            unpacked.body.unpack();
            assert_eq!(unpacked, expected);
        }
    }

    #[test]
    fn shared_functions_stay_shared() {
        let mut scratch = PackScratch::default();
        let shared = Arc::new(function(7));
        let packed = PackedFunction::new(Arc::clone(&shared), &mut scratch);
        assert_eq!(packed.has_parameters(), !shared.parameters.is_empty());
        assert!(Arc::ptr_eq(&packed.unpack(&mut scratch), &shared));
    }
}
