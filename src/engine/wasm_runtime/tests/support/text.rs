//! Assembles as much of the text format as the tests use. What it does not understand panics.

use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Clone, PartialEq, Debug)]
enum Node {
    Atom(String),
    Text(Vec<u8>),
    List(Vec<Node>),
}

impl Node {
    fn atom(&self) -> Option<&str> {
        match self {
            Self::Atom(atom) => Some(atom),
            _ => None,
        }
    }

    /// What follows the keyword, if this is a list that starts with it.
    fn after(&self, keyword: &str) -> Option<&[Node]> {
        match self {
            Self::List(nodes) if nodes.first()?.atom()? == keyword => Some(&nodes[1..]),
            _ => None,
        }
    }
}

fn parse_text(bytes: &mut std::iter::Peekable<std::str::Bytes<'_>>) -> Node {
    let mut text = Vec::new();
    loop {
        match bytes.next().unwrap() {
            b'"' => return Node::Text(text),
            b'\\' => {
                let digits = [bytes.next().unwrap(), bytes.next().unwrap()];
                text.push(u8::from_str_radix(std::str::from_utf8(&digits).unwrap(), 16).unwrap());
            }
            byte => text.push(byte),
        }
    }
}

fn parse(source: &str) -> Vec<Node> {
    let mut bytes = source.bytes().peekable();
    let mut open = vec![Vec::new()];
    while let Some(byte) = bytes.next() {
        let node = match byte {
            b'(' => {
                open.push(Vec::new());
                continue;
            }
            b';' => {
                bytes.find(|&byte| byte == b'\n');
                continue;
            }
            _ if byte.is_ascii_whitespace() => continue,
            b')' => Node::List(open.pop().unwrap()),
            b'"' => parse_text(&mut bytes),
            _ => {
                let mut atom = String::from(char::from(byte));
                let goes_on = |byte: &u8| !byte.is_ascii_whitespace() && !b"();".contains(byte);
                atom.extend(std::iter::from_fn(|| bytes.next_if(goes_on)).map(char::from));
                Node::Atom(atom)
            }
        };
        open.last_mut().unwrap().push(node);
    }
    assert_eq!(open.len(), 1);
    open.pop().unwrap()
}

/// What is left of a list.
struct Cursor<'a>(&'a [Node]);

impl<'a> Cursor<'a> {
    fn take<T>(&mut self, accept: impl FnOnce(&'a Node) -> Option<T>) -> Option<T> {
        let value = accept(self.0.first()?)?;
        self.0 = &self.0[1..];
        Some(value)
    }

    fn node(&mut self) -> &'a Node {
        self.take(Some).expect("more")
    }

    fn list(&mut self, keyword: &str) -> Option<Cursor<'a>> {
        self.take(|node| node.after(keyword)).map(Cursor)
    }

    fn keyword(&mut self, keyword: &str) -> bool {
        self.take(|node| node.atom().filter(|&it| it == keyword))
            .is_some()
    }

    fn name(&mut self) -> Option<&'a str> {
        self.take(|node| node.atom().filter(|it| it.starts_with('$')))
    }

    /// A name or a number.
    fn index(&mut self) -> Option<&'a str> {
        let is_index = |it: &&str| it.starts_with(|c: char| c == '$' || c.is_ascii_digit());
        self.take(|node| node.atom().filter(is_index))
    }

    fn text(&mut self) -> Option<&'a [u8]> {
        self.take(|node| match node {
            Node::Text(text) => Some(&text[..]),
            _ => None,
        })
    }

    fn setting(&mut self, prefix: &str) -> Option<i128> {
        self.take(|node| node.atom()?.strip_prefix(prefix))
            .map(integer)
    }
}

fn integer(text: &str) -> i128 {
    let text = text.replace('_', "");
    let magnitude = text.trim_start_matches('-');
    let value = match magnitude.strip_prefix("0x") {
        Some(digits) => u128::from_str_radix(digits, 16).unwrap() as i128,
        None => magnitude.parse().unwrap(),
    };
    if text.starts_with('-') { -value } else { value }
}

fn unsigned(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn signed(out: &mut Vec<u8>, mut value: i64) {
    while !(-0x40..0x40).contains(&value) {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8 & 0x7f);
}

fn sized(out: &mut Vec<u8>, bytes: &[u8]) {
    unsigned(out, bytes.len() as u64);
    out.extend(bytes);
}

const NUMERIC: &str = "i32.eqz i32.eq i32.ne i32.lt_s i32.lt_u i32.gt_s i32.gt_u i32.le_s i32.le_u i32.ge_s i32.ge_u
    i64.eqz i64.eq i64.ne i64.lt_s i64.lt_u i64.gt_s i64.gt_u i64.le_s i64.le_u i64.ge_s i64.ge_u
    f32.eq f32.ne f32.lt f32.gt f32.le f32.ge f64.eq f64.ne f64.lt f64.gt f64.le f64.ge
    i32.clz i32.ctz i32.popcnt i32.add i32.sub i32.mul i32.div_s i32.div_u i32.rem_s i32.rem_u
    i32.and i32.or i32.xor i32.shl i32.shr_s i32.shr_u i32.rotl i32.rotr
    i64.clz i64.ctz i64.popcnt i64.add i64.sub i64.mul i64.div_s i64.div_u i64.rem_s i64.rem_u
    i64.and i64.or i64.xor i64.shl i64.shr_s i64.shr_u i64.rotl i64.rotr
    f32.abs f32.neg f32.ceil f32.floor f32.trunc f32.nearest f32.sqrt
    f32.add f32.sub f32.mul f32.div f32.min f32.max f32.copysign
    f64.abs f64.neg f64.ceil f64.floor f64.trunc f64.nearest f64.sqrt
    f64.add f64.sub f64.mul f64.div f64.min f64.max f64.copysign
    i32.wrap_i64 i32.trunc_f32_s i32.trunc_f32_u i32.trunc_f64_s i32.trunc_f64_u
    i64.extend_i32_s i64.extend_i32_u i64.trunc_f32_s i64.trunc_f32_u i64.trunc_f64_s i64.trunc_f64_u
    f32.convert_i32_s f32.convert_i32_u f32.convert_i64_s f32.convert_i64_u f32.demote_f64
    f64.convert_i32_s f64.convert_i32_u f64.convert_i64_s f64.convert_i64_u f64.promote_f32
    i32.reinterpret_f32 i64.reinterpret_f64 f32.reinterpret_i32 f64.reinterpret_i64
    i32.extend8_s i32.extend16_s i64.extend8_s i64.extend16_s i64.extend32_s";
const ACCESSES: &str = "i32.load i64.load f32.load f64.load i32.load8_s i32.load8_u i32.load16_s i32.load16_u
    i64.load8_s i64.load8_u i64.load16_s i64.load16_u i64.load32_s i64.load32_u
    i32.store i64.store f32.store f64.store i32.store8 i32.store16 i64.store8 i64.store16 i64.store32";
const ATOMIC_UPDATES: &str = "add sub and or xor xchg cmpxchg";

/// The opcode, and a letter for each immediate: Type, Func, tAble, Memory, Global, taG (X), Elem, Data, Local, laBel,
/// Number, Heap type. A small letter is for one that is 0 if it is left out.
const OTHERS: &str = "unreachable 00; nop 01; throw 08 X; rethrow 09 B; throw_ref 0a; br 0c B; br_if 0d B; return 0f;
    call 10 F; return_call 12 F; call_ref 14 T; return_call_ref 15 T; drop 1a; select 1b;
    local.get 20 L; local.set 21 L; local.tee 22 L; global.get 23 G; global.set 24 G; table.get 25 a; table.set 26 a;
    memory.size 3f m; memory.grow 40 m; ref.null d0 H; ref.is_null d1; ref.func d2 F; ref.eq d3; ref.as_non_null d4;
    br_on_null d5 B; br_on_non_null d6 B; data.drop fc09 D; memory.copy fc0a mm; memory.fill fc0b m;
    elem.drop fc0d E; table.copy fc0e aa; table.grow fc0f a; table.size fc10 a; table.fill fc11 a;
    struct.new fb00 T; struct.new_default fb01 T; struct.get fb02 TN; struct.get_s fb03 TN; struct.get_u fb04 TN;
    struct.set fb05 TN; array.new fb06 T; array.new_default fb07 T; array.new_fixed fb08 TN; array.new_data fb09 TD;
    array.new_elem fb0a TE; array.get fb0b T; array.get_s fb0c T; array.get_u fb0d T; array.set fb0e T;
    array.len fb0f; array.fill fb10 T; array.copy fb11 TT; array.init_data fb12 TD; array.init_elem fb13 TE;
    any.convert_extern fb1a; extern.convert_any fb1b; ref.i31 fb1c; i31.get_s fb1d; i31.get_u fb1e;
    atomic.fence fe0300; i8x16.splat fd0f; i32x4.splat fd11; i64x2.splat fd12; i32x4.extract_lane fd1b N;
    i32x4.replace_lane fd1c N; i64x2.extract_lane fd1d N; i64x2.replace_lane fd1e N; v128.and fd4e; v128.or fd50;
    v128.xor fd51; v128.any_true fd53; i32x4.add fdae01; i32x4.mul fdb501; i64x2.add fdce01";

static REGULAR: LazyLock<HashMap<&str, (Vec<u8>, &str)>> = LazyLock::new(|| {
    let numeric = NUMERIC.split_whitespace().zip(0x45..);
    let others = OTHERS.split(';').map(|entry| {
        let mut words = entry.split_whitespace();
        let (name, opcode) = (words.next().unwrap(), words.next().unwrap());
        let byte = |at| u8::from_str_radix(&opcode[at..at + 2], 16).unwrap();
        let opcode = (0..opcode.len()).step_by(2).map(byte).collect();
        (name, (opcode, words.next().unwrap_or_default()))
    });
    let numeric = numeric.map(|(name, opcode)| (name, (vec![opcode], "")));
    numeric.chain(others).collect()
});

/// The opcode and the logarithm of the size.
fn access(name: &str) -> Option<(Vec<u8>, u8)> {
    let (ty, operation) = name.split_once('.')?;
    let digits: String = operation.chars().filter(char::is_ascii_digit).collect();
    let bits: u32 = [&digits, &ty[1..]]
        .iter()
        .find_map(|it| it.parse().ok())
        .unwrap_or(32);
    let shape = match (ty, bits) {
        ("i32", 32) => 0,
        ("i64", 64) => 1,
        ("i32", _) => 2 + bits as u8 / 16,
        _ => 4 + bits as u8 / 16,
    };
    let last = operation.rsplit('.').next()?.trim_end_matches("_u");
    let update = ATOMIC_UPDATES.split(' ').position(|it| it == last);
    let opcode = match name {
        "v128.load" => vec![0xfd, 0x00],
        "v128.store" => vec![0xfd, 0x0b],
        "memory.atomic.notify" => vec![0xfe, 0x00],
        "memory.atomic.wait32" => vec![0xfe, 0x01],
        "memory.atomic.wait64" => vec![0xfe, 0x02],
        _ if operation.starts_with("atomic.load") => vec![0xfe, 0x10 + shape],
        _ if operation.starts_with("atomic.store") => vec![0xfe, 0x17 + shape],
        _ if operation.starts_with("atomic.rmw") => vec![0xfe, 0x1e + 7 * update? as u8 + shape],
        _ => vec![0x28 + ACCESSES.split_whitespace().position(|it| it == name)? as u8],
    };
    Some((opcode, (bits / 8).ilog2() as u8))
}

const KINDS: [&str; 5] = ["func", "table", "memory", "global", "tag"];

#[derive(Default)]
struct Section {
    count: u64,
    bytes: Vec<u8>,
}

impl Section {
    fn entry(&mut self) -> &mut Vec<u8> {
        self.count += 1;
        &mut self.bytes
    }
}

#[derive(Default)]
struct Assembler<'a> {
    /// By the keyword of the index space.
    names: HashMap<(&'a str, &'a str), u64>,
    counts: HashMap<&'a str, u64>,
    signatures: HashMap<Vec<u8>, u64>,
    param_counts: HashMap<u64, u64>,
    sections: HashMap<u8, Section>,
    locals: HashMap<&'a str, u64>,
    labels: Vec<Option<&'a str>>,
}

impl<'a> Assembler<'a> {
    fn declare(&mut self, space: &'a str, name: Option<&'a str>) -> u64 {
        let count = self.counts.entry(space).or_default();
        *count += 1;
        self.names
            .extend(name.map(|name| ((space, name), *count - 1)));
        *count - 1
    }

    fn resolve(&self, space: &str, index: &str) -> u64 {
        let known = match space {
            "local" => self.locals.get(index).copied(),
            "label" => {
                let mut labels = self.labels.iter().rev();
                labels.position(|&it| it == Some(index)).map(|it| it as u64)
            }
            _ => self.names.get(&(space, index)).copied(),
        };
        known.unwrap_or_else(|| {
            index
                .parse()
                .unwrap_or_else(|_| panic!("no {space} {index}"))
        })
    }

    fn entry(&mut self, section: u8) -> &mut Vec<u8> {
        self.sections.entry(section).or_default().entry()
    }

    fn heap_type(&self, out: &mut Vec<u8>, name: &str) {
        const NAMES: &str = "exn array struct i31 eq any extern func none noextern nofunc noexn";
        match NAMES.split(' ').position(|it| it == name) {
            Some(position) => out.push(0x69 + position as u8),
            None => signed(out, self.resolve("type", name) as i64),
        }
    }

    fn value_type(&self, out: &mut Vec<u8>, node: &Node) {
        const NUMBERS: &str = "i16 i8 - - v128 f64 f32 i64 i32";
        if let Some(rest) = node.after("ref") {
            out.push(0x65 - rest.len() as u8);
            return self.heap_type(out, rest.last().unwrap().atom().unwrap());
        }
        let name = node.atom().unwrap();
        match NUMBERS.split(' ').position(|it| it == name) {
            Some(position) => out.push(0x77 + position as u8),
            None => self.heap_type(out, name.strip_suffix("ref").unwrap()),
        }
    }

    fn mutable_type(&self, out: &mut Vec<u8>, node: &Node) {
        let mutable = node.after("mut");
        self.value_type(out, mutable.map_or(node, |rest| &rest[0]));
        out.push(mutable.is_some().into());
    }

    /// Gives the names, one for each.
    fn types(
        &self,
        out: &mut Vec<u8>,
        cursor: &mut Cursor<'a>,
        keyword: &str,
        each: fn(&Self, &mut Vec<u8>, &Node),
    ) -> Vec<Option<&'a str>> {
        let (mut names, mut bytes) = (Vec::new(), Vec::new());
        while let Some(mut list) = cursor.list(keyword) {
            let name = list.name();
            for node in list.0 {
                names.push(name);
                each(self, &mut bytes, node);
            }
        }
        unsigned(out, names.len() as u64);
        out.extend(bytes);
        names
    }

    fn signature(&self, cursor: &mut Cursor<'a>) -> (Vec<u8>, Vec<Option<&'a str>>) {
        let mut bytes = vec![0x60];
        let names = self.types(&mut bytes, cursor, "param", Self::value_type);
        self.types(&mut bytes, cursor, "result", Self::value_type);
        (bytes, names)
    }

    fn type_use(&mut self, cursor: &mut Cursor<'a>) -> (u64, Vec<Option<&'a str>>) {
        let explicit = cursor.list("type").and_then(|mut it| it.index());
        let (bytes, mut names) = self.signature(cursor);
        if let Some(index) = explicit.map(|it| self.resolve("type", it)) {
            names.resize(self.param_counts[&index] as usize, None);
            return (index, names);
        }
        if !self.signatures.contains_key(&bytes) {
            let index = self.declare("type", None);
            self.entry(1).extend(&bytes);
            self.signatures.insert(bytes.clone(), index);
        }
        (self.signatures[&bytes], names)
    }

    fn define_type(&mut self, out: &mut Vec<u8>, mut cursor: Cursor<'a>, index: u64) {
        cursor.name();
        if let Some(mut sub) = cursor.list("sub") {
            out.push(if sub.keyword("final") { 0x4f } else { 0x50 });
            let supertype = sub.index();
            out.push(supertype.is_some().into());
            if let Some(supertype) = supertype {
                unsigned(out, self.resolve("type", supertype));
            }
            cursor = sub;
        }
        if let Some(mut func) = cursor.list("func") {
            let (bytes, names) = self.signature(&mut func);
            self.param_counts.insert(index, names.len() as u64);
            out.extend(bytes);
        } else if let Some(mut fields) = cursor.list("struct") {
            out.push(0x5f);
            self.types(out, &mut fields, "field", Self::mutable_type);
        } else {
            out.push(0x5e);
            self.mutable_type(out, cursor.list("array").unwrap().node());
        }
    }

    fn limits(out: &mut Vec<u8>, cursor: &mut Cursor<'a>) {
        let is_wide = cursor.keyword("i64");
        let (initial, maximum) = (cursor.index().unwrap(), cursor.index());
        let is_shared = cursor.keyword("shared");
        out.push(u8::from(maximum.is_some()) | u8::from(is_shared) << 1 | u8::from(is_wide) << 2);
        for limit in std::iter::once(initial).chain(maximum) {
            unsigned(out, integer(limit) as u64);
        }
    }

    /// What an import and a definition have in common.
    fn describe(&mut self, kind: &str, cursor: &mut Cursor<'a>) -> Vec<u8> {
        let mut out = Vec::new();
        match kind {
            "table" => {
                let mut limits = Vec::new();
                Self::limits(&mut limits, cursor);
                self.value_type(&mut out, cursor.node());
                out.extend(limits);
            }
            "memory" => Self::limits(&mut out, cursor),
            "global" => self.mutable_type(&mut out, cursor.node()),
            _ => {
                out.extend((kind == "tag").then_some(0));
                let (ty, names) = self.type_use(cursor);
                unsigned(&mut out, ty);
                self.locals.clear();
                self.counts.insert("local", names.len() as u64);
                let named = names.into_iter().zip(0..);
                self.locals
                    .extend(named.filter_map(|(name, index)| Some((name?, index))));
            }
        }
        out
    }

    fn block_type(&mut self, out: &mut Vec<u8>, cursor: &mut Cursor<'a>) {
        let before = cursor.0;
        match &self.signature(cursor).0[1..] {
            [0, 0] => out.push(0x40),
            [0, 1, result @ ..] => out.extend(result),
            _ => {
                cursor.0 = before;
                let ty = self.type_use(cursor).0;
                signed(out, ty as i64);
            }
        }
    }

    fn catches(&self, out: &mut Vec<u8>, cursor: &mut Cursor<'a>) {
        const CLAUSES: [&str; 4] = ["catch", "catch_ref", "catch_all", "catch_all_ref"];
        let mut section = Section::default();
        while let Some((kind, mut clause)) =
            (0..4).find_map(|kind| Some((kind, cursor.list(CLAUSES[kind])?)))
        {
            let out = section.entry();
            out.push(kind as u8);
            if kind < 2 {
                unsigned(out, self.resolve("tag", clause.index().unwrap()));
            }
            unsigned(out, self.resolve("label", clause.index().unwrap()));
        }
        unsigned(out, section.count);
        out.extend(section.bytes);
    }

    /// The opcode and the immediates of an instruction that opens no block.
    fn plain(&mut self, name: &str, cursor: &mut Cursor<'a>) -> Vec<u8> {
        let mut out = Vec::new();
        let number = |cursor: &mut Cursor<'a>| cursor.node().atom().unwrap();
        if let Some(&(ref opcode, immediates)) = REGULAR.get(name) {
            out.extend(opcode);
            self.immediates(&mut out, immediates, cursor);
            return out;
        }
        if let Some((opcode, log2_size)) = access(name) {
            let memory = cursor.index().map(|it| self.resolve("memory", it));
            out.extend(opcode);
            out.push(log2_size | u8::from(memory.is_some()) << 6);
            out.extend(memory.map(|it| it as u8));
            unsigned(&mut out, cursor.setting("offset=").unwrap_or(0) as u64);
            return out;
        }
        match name {
            "i32.const" => {
                out.push(0x41);
                signed(&mut out, (integer(number(cursor)) as i32).into());
            }
            "i64.const" => {
                out.push(0x42);
                signed(&mut out, integer(number(cursor)) as i64);
            }
            "f32.const" => {
                out.push(0x43);
                out.extend(number(cursor).parse::<f32>().unwrap().to_le_bytes());
            }
            "f64.const" => {
                out.push(0x44);
                out.extend(number(cursor).parse::<f64>().unwrap().to_le_bytes());
            }
            "v128.const" => {
                assert!(cursor.keyword("i64x2"));
                out.extend([0xfd, 0x0c]);
                out.extend((integer(number(cursor)) as u64).to_le_bytes());
                out.extend((integer(number(cursor)) as u64).to_le_bytes());
            }
            "br_table" => {
                let labels: Vec<_> = std::iter::from_fn(|| cursor.index()).collect();
                out.push(0x0e);
                unsigned(&mut out, labels.len() as u64 - 1);
                for label in labels {
                    unsigned(&mut out, self.resolve("label", label));
                }
            }
            "call_indirect" | "return_call_indirect" => {
                let table = cursor.index().map_or(0, |it| self.resolve("table", it));
                out.push(if name == "call_indirect" { 0x11 } else { 0x13 });
                let ty = self.type_use(cursor).0;
                unsigned(&mut out, ty);
                unsigned(&mut out, table);
            }
            "memory.init" | "table.init" => {
                let (opcode, spaces) = match name {
                    "memory.init" => (0x08, ["memory", "data"]),
                    _ => (0x0c, ["table", "elem"]),
                };
                let (first, second) = (cursor.index().unwrap(), cursor.index());
                out.extend([0xfc, opcode]);
                unsigned(&mut out, self.resolve(spaces[1], second.unwrap_or(first)));
                unsigned(
                    &mut out,
                    second.map_or(0, |_| self.resolve(spaces[0], first)),
                );
            }
            "ref.test" | "ref.cast" => {
                let mut ty = cursor.list("ref").unwrap();
                let opcode = if name == "ref.test" { 0x14 } else { 0x16 };
                out.extend([0xfb, opcode + u8::from(ty.keyword("null"))]);
                self.heap_type(&mut out, number(&mut ty));
            }
            "br_on_cast" | "br_on_cast_fail" => {
                let label = self.resolve("label", cursor.index().unwrap());
                let [mut from, mut to] = [(); 2].map(|()| cursor.list("ref").unwrap());
                let nulls = u8::from(from.keyword("null")) | u8::from(to.keyword("null")) << 1;
                out.extend([0xfb, 0x18 + u8::from(name != "br_on_cast"), nulls]);
                unsigned(&mut out, label);
                self.heap_type(&mut out, number(&mut from));
                self.heap_type(&mut out, number(&mut to));
            }
            _ => panic!("no instruction {name}"),
        }
        out
    }

    fn immediates(&self, out: &mut Vec<u8>, letters: &str, cursor: &mut Cursor<'a>) {
        for letter in letters.chars() {
            let space = match letter.to_ascii_uppercase() {
                'H' => return self.heap_type(out, cursor.node().atom().unwrap()),
                'T' => "type",
                'F' => "func",
                'A' => "table",
                'M' => "memory",
                'G' => "global",
                'X' => "tag",
                'E' => "elem",
                'D' => "data",
                'L' => "local",
                'B' => "label",
                _ => "number",
            };
            let index = cursor
                .index()
                .or_else(|| letter.is_ascii_lowercase().then_some("0"));
            unsigned(out, self.resolve(space, index.unwrap()));
        }
    }

    fn open_block(&mut self, name: &str, cursor: &mut Cursor<'a>) -> Option<Vec<u8>> {
        let opcodes = [
            ("block", 2),
            ("loop", 3),
            ("if", 4),
            ("try", 6),
            ("try_table", 0x1f),
        ];
        let mut out = vec![opcodes.iter().find(|entry| entry.0 == name)?.1];
        let label = cursor.name();
        self.block_type(&mut out, cursor);
        if name == "try_table" {
            self.catches(&mut out, cursor);
        }
        self.labels.push(label);
        Some(out)
    }

    fn folded(&mut self, out: &mut Vec<u8>, nodes: &'a [Node]) {
        let (name, mut cursor) = (nodes[0].atom().unwrap(), Cursor(&nodes[1..]));
        let Some(start) = self.open_block(name, &mut cursor) else {
            let instruction = self.plain(name, &mut cursor);
            self.instructions(out, cursor);
            return out.extend(instruction);
        };
        if name == "if" {
            let then = cursor
                .0
                .iter()
                .position(|it| it.after("then").is_some())
                .unwrap();
            let label = self.labels.pop().unwrap();
            self.instructions(out, Cursor(&cursor.0[..then]));
            self.labels.push(label);
            cursor.0 = &cursor.0[then..];
        }
        out.extend(start);
        if let Some(then) = cursor.list("then") {
            self.instructions(out, then);
        }
        if let Some(otherwise) = cursor.list("else") {
            out.push(0x05);
            self.instructions(out, otherwise);
        }
        self.instructions(out, cursor);
        self.labels.pop();
        out.push(0x0b);
    }

    fn instructions(&mut self, out: &mut Vec<u8>, mut cursor: Cursor<'a>) {
        while let Some(node) = cursor.take(Some) {
            let name = match node {
                Node::List(nodes) => {
                    self.folded(out, nodes);
                    continue;
                }
                other => other.atom().unwrap(),
            };
            match name {
                "else" => out.push(0x05),
                "catch_all" => out.push(0x19),
                "catch" => {
                    out.push(0x07);
                    unsigned(out, self.resolve("tag", cursor.index().unwrap()));
                }
                "end" => {
                    self.labels.pop();
                    out.push(0x0b);
                }
                "delegate" => {
                    self.labels.pop();
                    out.push(0x18);
                    unsigned(out, self.resolve("label", cursor.index().unwrap()));
                }
                _ => match self.open_block(name, &mut cursor) {
                    Some(start) => out.extend(start),
                    None => out.extend(self.plain(name, &mut cursor)),
                },
            }
        }
    }

    fn expression(&mut self, nodes: &'a [Node]) -> Vec<u8> {
        let mut out = Vec::new();
        self.instructions(&mut out, Cursor(nodes));
        out.push(0x0b);
        out
    }

    fn body(&mut self, mut cursor: Cursor<'a>) {
        let one_of = |this: &Self, out: &mut Vec<u8>, node: &Node| {
            out.push(1);
            this.value_type(out, node);
        };
        let mut body = Vec::new();
        for name in self.types(&mut body, &mut cursor, "local", one_of) {
            let index = self.declare("local", None);
            self.locals.extend(name.map(|name| (name, index)));
        }
        body.extend(self.expression(cursor.0));
        sized(self.entry(10), &body);
    }

    fn define(&mut self, kind: usize, index: u64, mut cursor: Cursor<'a>) {
        cursor.name();
        while let Some(mut export) = cursor.list("export") {
            let out = self.entry(7);
            sized(out, export.text().unwrap());
            out.push(kind as u8);
            unsigned(out, index);
        }
        let mut bytes = self.describe(KINDS[kind], &mut cursor);
        match KINDS[kind] {
            "func" => self.body(cursor),
            "global" => bytes.extend(self.expression(cursor.0)),
            "table" if !cursor.0.is_empty() => {
                bytes.splice(..0, [0x40, 0]);
                bytes.extend(self.expression(cursor.0));
            }
            _ => {}
        }
        self.entry([3, 4, 5, 6, 13][kind]).extend(bytes);
    }

    /// For an active segment, the index of the table or memory and the offset.
    fn destination(&mut self, space: &str, cursor: &mut Cursor<'a>) -> Option<Vec<u8>> {
        let index = cursor.list(space).and_then(|mut it| it.index());
        let is_offset = |node: &Node| matches!(node, Node::List(_)) && node.after("ref").is_none();
        let offset = cursor.take(|node| is_offset(node).then_some(node))?;
        let mut out = Vec::new();
        unsigned(&mut out, index.map_or(0, |it| self.resolve(space, it)));
        out.extend(self.expression(std::slice::from_ref(offset)));
        Some(out)
    }

    fn elem(&mut self, mut cursor: Cursor<'a>) {
        cursor.name();
        let is_declared = cursor.keyword("declare");
        let destination = self.destination("table", &mut cursor);
        let has_indices = cursor.keyword("func");
        let mode = if destination.is_some() {
            2
        } else {
            1 + 2 * u8::from(is_declared)
        };
        let mut out = vec![mode | u8::from(!has_indices) << 2];
        out.extend(destination.unwrap_or_default());
        match has_indices {
            true => out.push(0),
            false => self.value_type(&mut out, cursor.node()),
        }
        unsigned(&mut out, cursor.0.len() as u64);
        for item in cursor.0 {
            match item.atom() {
                Some(func) => unsigned(&mut out, self.resolve("func", func)),
                None => out.extend(self.expression(std::slice::from_ref(item))),
            }
        }
        self.entry(9).extend(out);
    }

    fn data(&mut self, mut cursor: Cursor<'a>) {
        cursor.name();
        let destination = self.destination("memory", &mut cursor);
        let out = self.entry(11);
        out.push(1 + u8::from(destination.is_some()));
        out.extend(destination.unwrap_or_default());
        sized(out, cursor.text().unwrap_or_default());
    }

    fn declare_field(&mut self, field: &'a Node) {
        let Node::List(nodes) = field else { panic!() };
        match nodes[0].atom().unwrap() {
            "rec" => nodes[1..].iter().for_each(|it| self.declare_field(it)),
            "import" => self.declare_field(&nodes[3]),
            space => drop(self.declare(space, Cursor(&nodes[1..]).name())),
        }
    }

    fn define_types(&mut self, fields: &'a [Node]) {
        let mut index = 0;
        for field in fields {
            let mut out = Vec::new();
            let members = match field.after("rec") {
                Some(members) => {
                    out.extend([0x4e, members.len() as u8]);
                    members
                }
                None if field.after("type").is_some() => std::slice::from_ref(field),
                None => continue,
            };
            for member in members {
                self.define_type(&mut out, Cursor(member.after("type").unwrap()), index);
                index += 1;
            }
            self.entry(1).extend(out);
        }
    }

    fn define_field(&mut self, field: &'a Node, next_index: &mut [u64; 5]) {
        let kind_of = |node: &'a Node| {
            (0..KINDS.len()).find_map(|kind| Some((kind, Cursor(node.after(KINDS[kind])?))))
        };
        if let Some((kind, cursor)) = kind_of(field) {
            next_index[kind] += 1;
            self.define(kind, next_index[kind] - 1, cursor);
        } else if let Some(mut import) = field.after("import").map(Cursor) {
            let names = [import.text().unwrap(), import.text().unwrap()];
            let (kind, mut cursor) = kind_of(import.node()).unwrap();
            next_index[kind] += 1;
            cursor.name();
            let description = self.describe(KINDS[kind], &mut cursor);
            let out = self.entry(2);
            names.into_iter().for_each(|name| sized(out, name));
            out.push(kind as u8);
            out.extend(description);
        } else if let Some(mut export) = field.after("export").map(Cursor) {
            let name = export.text().unwrap();
            let (kind, mut cursor) = kind_of(export.node()).unwrap();
            let index = self.resolve(KINDS[kind], cursor.index().unwrap());
            let out = self.entry(7);
            sized(out, name);
            out.push(kind as u8);
            unsigned(out, index);
        } else if let Some(elem) = field.after("elem") {
            self.elem(Cursor(elem));
        } else if let Some(data) = field.after("data") {
            self.data(Cursor(data));
        }
    }
}

/// `source` has the fields of a module, imports first.
pub(crate) fn assemble(source: &str) -> Vec<u8> {
    let fields = parse(source);
    let mut assembler = Assembler::default();
    fields.iter().for_each(|it| assembler.declare_field(it));
    assembler.define_types(&fields);
    let mut next_index = [0; 5];
    for field in &fields {
        assembler.define_field(field, &mut next_index);
    }
    // These two have a number and nothing else.
    let start = fields.iter().find_map(|it| it.after("start"));
    let start = start.map(|it| assembler.resolve("func", it[0].atom().unwrap()));
    let data_count = assembler.counts.get("data").copied();
    for (id, count) in [(8, start), (12, data_count)] {
        let bytes = Vec::new();
        assembler
            .sections
            .extend(count.map(|count| (id, Section { count, bytes })));
    }

    let mut module = b"\0asm\x01\0\0\0".to_vec();
    for id in [1, 2, 3, 4, 5, 13, 6, 7, 8, 9, 12, 10, 11] {
        if let Some(section) = assembler.sections.remove(&id) {
            let mut payload = Vec::new();
            unsigned(&mut payload, section.count);
            payload.extend(section.bytes);
            module.push(id);
            sized(&mut module, &payload);
        }
    }
    module
}
