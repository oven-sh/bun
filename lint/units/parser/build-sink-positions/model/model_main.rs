// Driver of the model: one line of input per type, read at run time so that nothing is folded.

#[cfg(p2)]
fn dump(t: &ts::Type, src: &[u8], depth: usize, w: &mut String) {
    use std::fmt::Write;
    let text = String::from_utf8_lossy(&src[t.start as usize..(t.end as usize).min(src.len())]).into_owned();
    let pad = " ".repeat(depth);
    let kind = match t.data {
        ts::TypeData::Keyword(_) => "Keyword",
        ts::TypeData::This => "This",
        ts::TypeData::Number(_) | ts::TypeData::Str(_) | ts::TypeData::Negative(..) => "Literal",
        ts::TypeData::TypeReference(_) => "TypeReference",
        ts::TypeData::TypeQuery(_) => "TypeQuery",
        ts::TypeData::Array(_) => "ArrayType",
        ts::TypeData::IndexedAccess(_) => "IndexedAccessType",
        ts::TypeData::Tuple(_) => "TupleType",
        ts::TypeData::NamedTupleMember(_) => "NamedTupleMember",
        ts::TypeData::Rest(_) => "RestType",
        ts::TypeData::Optional(_) => "OptionalType",
        ts::TypeData::Union(_) => "UnionType",
        ts::TypeData::Intersection(_) => "IntersectionType",
        ts::TypeData::Conditional(_) => "ConditionalType",
        ts::TypeData::Parenthesized(_) => "ParenthesizedType",
        ts::TypeData::NonNull(_) => "JSDocNonNullableType",
        ts::TypeData::Nullable(_) => "JSDocNullableType",
        ts::TypeData::TypeLiteral(_) => "TypeLiteral",
        ts::TypeData::Operator(..) => "TypeOperator",
    };
    let _ = writeln!(w, "{pad}{kind} start {} end {} {:?}", t.start, t.end, text);
    let list = |l: &ts::NodeList<ts::Type>, name: &str, w: &mut String| {
        let _ = writeln!(w, "{pad} list {name} end {} count {} trailing {}", l.end, l.items.len(), l.items.last().is_some_and(|x| x.end < l.end));
        for c in l.items {
            dump(c, src, depth + 1, w);
        }
    };
    match t.data {
        ts::TypeData::TypeReference(r) | ts::TypeData::TypeQuery(r) => {
            let _ = writeln!(w, "{pad} name start {} end {}", r.type_name.start(), r.type_name.end());
            if let Some(a) = &r.type_arguments {
                list(a, "typeArguments", w);
            }
        }
        ts::TypeData::Array(e) | ts::TypeData::Rest(e) | ts::TypeData::Optional(e) | ts::TypeData::Parenthesized(e) | ts::TypeData::NonNull(e) | ts::TypeData::Nullable(e) | ts::TypeData::Operator(_, e) => dump(e, src, depth + 1, w),
        ts::TypeData::IndexedAccess(p) => {
            dump(&p.0, src, depth + 1, w);
            dump(&p.1, src, depth + 1, w);
        }
        ts::TypeData::Tuple(l) => list(l, "elements", w),
        ts::TypeData::Union(l) | ts::TypeData::Intersection(l) => list(l, "types", w),
        ts::TypeData::NamedTupleMember(m) => {
            let _ = writeln!(w, "{pad} label start {} end {} dots {:?} question {:?}", m.name.start, m.name.end, m.dot_dot_dot, m.question);
            dump(&m.type_node, src, depth + 1, w);
        }
        ts::TypeData::Conditional(c) => {
            dump(&c.check, src, depth + 1, w);
            dump(&c.extends, src, depth + 1, w);
            dump(&c.when_true, src, depth + 1, w);
            dump(&c.when_false, src, depth + 1, w);
        }
        ts::TypeData::TypeLiteral(l) => {
            let _ = writeln!(w, "{pad} list members end {} count {}", l.end, l.items.len());
            for m in l.items {
                let _ = writeln!(w, "{pad} PropertySignature start {} end {} {:?} question {:?}", m.start, m.end, String::from_utf8_lossy(&src[m.start as usize..m.end as usize]), m.question);
                if let Some(t) = &m.type_node {
                    dump(t, src, depth + 2, w);
                }
            }
        }
        _ => {}
    }
}

fn run<S: TypeSink>(src: &[u8], arena: &Arena) -> (Result<(), Error>, S::Out, usize, T, u32, usize) {
    let mut p = P::<true, false> { lexer: Lexer::new(src, arena), stack_limit: 4096, symbols: Vec::new() };
    let mut out = S::Out::default();
    let r = match p.lexer.next() {
        Ok(()) => p.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, &mut out),
        Err(e) => Err(e),
    };
    (r, out, p.lexer.start, p.lexer.token, p.lexer.errors, p.symbols.len())
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_default();
    let text = std::fs::read(&path).unwrap_or_default();
    let arena = Arena;
    let mut report = String::new();
    for line in text.split(|b| *b == b'\n') {
        if line.is_empty() {
            continue;
        }
        let line = black_box(line);
        use std::fmt::Write;
        let _ = writeln!(report, "== {:?}", String::from_utf8_lossy(line));
        let (r, (), at, tok, errors, symbols) = run::<Discard>(line, &arena);
        let _ = writeln!(report, "   discard ok={} stop={} {:?} errors={} symbols={}", r.is_ok(), at, tok, errors, symbols);
        let (r, m, at, tok, errors, symbols) = run::<DecoratorMetadata>(line, &arena);
        let _ = writeln!(report, "   metadata ok={} stop={} {:?} errors={} symbols={} tag={:?}", r.is_ok(), at, tok, errors, symbols, m);
        #[cfg(p2)]
        {
            let (r, t, at, tok, errors, symbols) = run::<Build>(line, &arena);
            let _ = writeln!(report, "   build ok={} stop={} {:?} errors={} symbols={}", r.is_ok(), at, tok, errors, symbols);
            if let Some(t) = t {
                dump(&t, line, 3, &mut report);
            }
        }
    }
    print!("{report}");
}
