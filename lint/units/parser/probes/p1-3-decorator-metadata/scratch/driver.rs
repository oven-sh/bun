// A cut of the grammar that calls the hooks in the order of parse_skip_typescript.rs, to run the sink on its own.
use std::io::BufRead;

struct Lx<'a> {
    toks: Vec<&'a str>,
    i: usize,
    names: Vec<&'a [u8]>,
}

impl<'a> Lx<'a> {
    fn tok(&self) -> &'a str {
        self.toks.get(self.i).copied().unwrap_or("<eof>")
    }
    fn next(&mut self) {
        self.i += 1;
    }
    fn expect(&mut self, t: &str) {
        assert_eq!(self.tok(), t, "at {}", self.i);
        self.next();
    }
    fn find(&mut self, name: &'a [u8]) -> Result<Ref, ()> {
        if let Some(i) = self.names.iter().position(|n| *n == name) {
            return Ok(Ref(i as u32));
        }
        self.names.push(name);
        Ok(Ref(self.names.len() as u32 - 1))
    }
    fn load(&self, r: Ref) -> &'a [u8] {
        self.names[r.0 as usize]
    }

    fn parse_type<S: TypeSink>(&mut self, disallow: bool, out: &mut S::Out) {
        self.union_or_intersection::<S>(true, out);
        if self.tok() == "extends" && !disallow {
            self.next();
            let mut extends_out = S::Out::default();
            self.parse_type::<S>(true, &mut extends_out);
            self.expect("?");
            let mut when_true = S::branch();
            self.parse_type::<S>(false, &mut when_true);
            self.expect(":");
            match S::conditional_true(out, when_true, |r| self.load(r)) {
                Operand::Decided => self.parse_type::<Discard>(false, &mut ()),
                Operand::Open(left) => {
                    self.parse_type::<S>(false, out);
                    S::conditional_false(out, left);
                }
            }
        }
    }

    fn union_or_intersection<S: TypeSink>(&mut self, is_union: bool, out: &mut S::Out) {
        self.constituent::<S>(is_union, out);
        let operator = if is_union { "|" } else { "&" };
        while self.tok() == operator {
            self.next();
            let left = if is_union {
                S::union_left(out, |r| self.load(r))
            } else {
                S::intersection_left(out, |r| self.load(r))
            };
            match left {
                Operand::Decided => self.constituent::<Discard>(is_union, &mut ()),
                Operand::Open(left) => {
                    self.constituent::<S>(is_union, out);
                    if is_union {
                        S::union_right(out, left);
                    } else {
                        S::intersection_right(out, left);
                    }
                }
            }
        }
    }

    fn constituent<S: TypeSink>(&mut self, is_union: bool, out: &mut S::Out) {
        if is_union {
            self.union_or_intersection::<S>(false, out);
        } else {
            self.postfix::<S>(out);
        }
    }

    fn postfix<S: TypeSink>(&mut self, out: &mut S::Out) {
        let t = self.tok();
        self.next();
        match t {
            "(" => {
                let mut inner = S::nested(out);
                self.parse_type::<S>(false, &mut inner);
                S::parenthesized(out, inner);
                self.expect(")");
            }
            "any" => S::keyword(out, TypeKeyword::Any),
            "never" => S::keyword(out, TypeKeyword::Never),
            "unknown" => S::keyword(out, TypeKeyword::Unknown),
            "undefined" => S::keyword(out, TypeKeyword::Undefined),
            "object" => S::keyword(out, TypeKeyword::Object),
            "number" => S::keyword(out, TypeKeyword::Number),
            "string" => S::keyword(out, TypeKeyword::String),
            "boolean" => S::keyword(out, TypeKeyword::Boolean),
            "bigint" => S::keyword(out, TypeKeyword::Bigint),
            "symbol" => S::keyword(out, TypeKeyword::Symbol),
            "null" => S::keyword(out, TypeKeyword::Null),
            "void" => S::keyword(out, TypeKeyword::Void),
            "this" => S::keyword(out, TypeKeyword::This),
            "1" => S::literal(out, TypeLiteral::Number),
            "s" => S::literal(out, TypeLiteral::String),
            "true" => S::literal(out, TypeLiteral::Boolean),
            "fn" => S::function_type(out),
            "imp" => S::import_type(out),
            "uniq" => S::unique_type(out),
            "obj" => S::object_type(out),
            "tup" => S::tuple_type(out),
            "tpl" => S::template_literal_type(out),
            "pred" => S::type_predicate(out, false),
            "asrt" => S::type_predicate(out, true),
            "infer" => self.next(),
            "typeof" => {
                self.next();
                S::typeof_query(out);
            }
            "keyof" => {
                self.postfix::<Discard>(&mut ());
                S::keyof_type(out);
            }
            "readonly" => {
                self.postfix::<Discard>(&mut ());
                S::readonly_type(out);
            }
            name => {
                let name: &'a [u8] = name.as_bytes();
                let _ = S::reference(out, name, |name| self.find(name));
            }
        }
        loop {
            match self.tok() {
                "[" => {
                    self.next();
                    let has_index = self.tok() != "]";
                    if has_index {
                        self.parse_type::<Discard>(false, &mut ());
                    }
                    self.expect("]");
                    S::index_or_array(out, has_index);
                }
                "." => {
                    self.next();
                    let name: &'a [u8] = self.tok().as_bytes();
                    let _ = S::member(out, name, true, |name| self.find(name));
                    self.next();
                }
                _ => return,
            }
        }
    }
}

fn tag_of(lx: &Lx<'_>, m: &Metadata) -> String {
    match m {
        Metadata::MNone | Metadata::MAny | Metadata::MUnknown | Metadata::MObject => "Object".into(),
        Metadata::MNever | Metadata::MUndefined | Metadata::MNull | Metadata::MVoid => "undefined".into(),
        Metadata::MString => "String".into(),
        Metadata::MNumber => "Number".into(),
        Metadata::MFunction => "Function".into(),
        Metadata::MBoolean => "Boolean".into(),
        Metadata::MArray => "Array".into(),
        Metadata::MBigint => "BigInt".into(),
        Metadata::MSymbol => "Symbol".into(),
        Metadata::MPromise => "Promise".into(),
        Metadata::MIdentifier(r) => {
            let name = String::from_utf8_lossy(lx.load(*r)).to_string();
            if name == "Object" { name } else { format!("Ref({name})") }
        }
        Metadata::MDot(refs) => {
            let names: Vec<String> = refs.iter().map(|r| String::from_utf8_lossy(lx.load(*r)).to_string()).collect();
            format!("Ref({})", names.join("."))
        }
    }
}

fn main() {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let mut spaced = String::new();
        for c in line.chars() {
            if "()[]|&?:.".contains(c) {
                spaced.push(' ');
                spaced.push(c);
                spaced.push(' ');
            } else {
                spaced.push(c);
            }
        }
        let mut lx = Lx { toks: spaced.split_whitespace().collect(), i: 0, names: Vec::new() };
        let mut out = Tag::default();
        lx.parse_type::<DecoratorMetadata>(false, &mut out);
        assert_eq!(lx.tok(), "<eof>", "trailing in {line}");
        println!("{}\t{}", line, tag_of(&lx, &out.metadata));
    }
}
