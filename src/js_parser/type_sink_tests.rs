//! Types read alone by the sink that builds nodes, with no lint parse around them: the kinds and the ranges are those of tsc 6.0.2.

use core::mem::MaybeUninit;

use bun_alloc::Arena;
use bun_ast::op::Level;
use bun_ast::ts::{self, MemberData, TypeData};

use crate::defines::Define;
use crate::lexer::T;
use crate::p::P;
use crate::parse::parse_entry::{Options, Parser};

/// What `read` makes of a TypeScript parser whose lexer is on the first token of `text`. `None`: `text` starts with no token.
fn with_parser<R>(
    text: &'static [u8],
    read: impl FnOnce(&mut P<'_, true, false>) -> R,
) -> Option<R> {
    let path: &'static [u8] = b"/a.ts";
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path, text);
    let mut options = Options::init(Default::default(), bun_ast::Loader::Ts);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    let mut slot = MaybeUninit::<P<'_, true, false>>::uninit();
    P::init(
        &mut slot,
        parser.bump,
        parser.log,
        parser.source,
        parser.define,
        parser.lexer,
        parser.options,
    )
    .ok()?;
    // SAFETY: `init` returned `Ok`, so the slot holds a parser.
    let found = read(unsafe { slot.assume_init_mut() });
    // SAFETY: the slot holds the parser that `init` made, and nothing reads it after this.
    unsafe { slot.assume_init_drop() };
    Some(found)
}

/// The type arguments of a node, for the kinds that take them.
fn type_arguments(data: &TypeData) -> Option<ts::List<ts::Type>> {
    match data {
        TypeData::TypeReference(reference) => reference.type_arguments,
        TypeData::ExpressionWithTypeArguments(expression) => expression.type_arguments,
        TypeData::TypeQuery(query) => query.type_arguments,
        TypeData::Import(import) => import.type_arguments,
        _ => None,
    }
}

/// The type parameters of a function type or of a constructor type.
fn type_parameters(data: &TypeData) -> Option<ts::List<ts::TypeParameter>> {
    match data {
        TypeData::Function(function) => function.type_parameters,
        TypeData::Constructor(constructor) => constructor.type_parameters,
        _ => None,
    }
}

/// A line for `node` and for each type inside it, in the order of the source: the kind, the range, and the range of a list of type arguments or of type parameters.
fn outline(node: ts::Type, lines: &mut Vec<String>) {
    let kind = node.data.kind_name();
    let mut line = format!("{kind}[{},{})", node.start, node.end);
    if let Some(list) = type_arguments(&node.data) {
        line.push_str(&format!("<{},{}>", list.start, list.end));
    }
    if let Some(list) = type_parameters(&node.data) {
        line.push_str(&format!("{{{},{}}}", list.start, list.end));
    }
    lines.push(line);
    match node.data {
        TypeData::Keyword(_) | TypeData::This | TypeData::JSDocAll | TypeData::Literal(_) => {}
        TypeData::TypeReference(reference) => each(reference.type_arguments, lines),
        TypeData::ExpressionWithTypeArguments(expression) => each(expression.type_arguments, lines),
        TypeData::Array(array) => outline(array.element_type, lines),
        TypeData::Tuple(tuple) => each(Some(tuple.elements), lines),
        TypeData::NamedTupleMember(member) => outline(member.type_node, lines),
        TypeData::Optional(optional) => outline(optional.type_node, lines),
        TypeData::Rest(rest) => outline(rest.type_node, lines),
        TypeData::Union(union) => each(Some(union.types), lines),
        TypeData::Intersection(intersection) => each(Some(intersection.types), lines),
        TypeData::Conditional(conditional) => {
            outline(conditional.check_type, lines);
            outline(conditional.extends_type, lines);
            outline(conditional.true_type, lines);
            outline(conditional.false_type, lines);
        }
        TypeData::Infer(infer) => type_parameter(&infer.type_parameter, lines),
        TypeData::Mapped(mapped) => {
            type_parameter(&mapped.type_parameter, lines);
            if_any(mapped.name_type, lines);
            if_any(mapped.type_node, lines);
            members(&mapped.members, lines);
        }
        TypeData::IndexedAccess(access) => {
            outline(access.object_type, lines);
            outline(access.index_type, lines);
        }
        TypeData::TypeOperator(operator) => outline(operator.type_node, lines),
        TypeData::TypeQuery(query) => each(query.type_arguments, lines),
        TypeData::Function(function) => {
            let (type_parameters, returns) = (function.type_parameters, function.type_node);
            signature(type_parameters, function.parameters, returns, lines);
        }
        TypeData::Constructor(constructor) => {
            let (type_parameters, returns) = (constructor.type_parameters, constructor.type_node);
            signature(type_parameters, constructor.parameters, returns, lines);
        }
        TypeData::TypeLiteral(literal) => members(&literal.members, lines),
        TypeData::TemplateLiteral(template) => {
            for span in template.template_spans.iter() {
                outline(span.type_node, lines);
            }
        }
        TypeData::Import(import) => {
            outline(import.argument, lines);
            each(import.type_arguments, lines);
        }
        TypeData::Parenthesized(parenthesized) => outline(parenthesized.type_node, lines),
        TypeData::TypePredicate(predicate) => {
            if let ts::TypePredicateParameterName::This { start, end } = predicate.parameter_name {
                lines.push(format!("ThisType[{start},{end})"));
            }
            if_any(predicate.type_node, lines);
        }
        TypeData::JSDocNullable(nullable) => outline(nullable.type_node, lines),
        TypeData::JSDocNonNullable(non_nullable) => outline(non_nullable.type_node, lines),
    }
}

fn if_any(node: Option<ts::Type>, lines: &mut Vec<String>) {
    if let Some(node) = node {
        outline(node, lines);
    }
}

fn each(list: Option<ts::List<ts::Type>>, lines: &mut Vec<String>) {
    for &node in list.iter().flat_map(|list| list.iter()) {
        outline(node, lines);
    }
}

fn type_parameter(parameter: &ts::TypeParameter, lines: &mut Vec<String>) {
    if_any(parameter.constraint, lines);
    if_any(parameter.default_type, lines);
}

/// The types of a signature: those of its type parameters, those of its parameters, and the one it returns.
fn signature(
    type_parameters: Option<ts::List<ts::TypeParameter>>,
    parameters: ts::List<ts::Parameter>,
    returns: Option<ts::Type>,
    lines: &mut Vec<String>,
) {
    for parameter in type_parameters.iter().flat_map(|list| list.iter()) {
        type_parameter(parameter, lines);
    }
    for parameter in parameters.iter() {
        if_any(parameter.type_node, lines);
    }
    if_any(returns, lines);
}

fn members(list: &[ts::Member], lines: &mut Vec<String>) {
    for member in list {
        let (type_parameters, parameters, returns) = match member.data {
            MemberData::PropertySignature(property) => {
                if_any(property.type_node, lines);
                continue;
            }
            MemberData::MethodSignature(method) => {
                (method.type_parameters, method.parameters, method.type_node)
            }
            MemberData::CallSignature(call) => {
                (call.type_parameters, call.parameters, call.type_node)
            }
            MemberData::ConstructSignature(construct) => (
                construct.type_parameters,
                construct.parameters,
                construct.type_node,
            ),
            MemberData::IndexSignature(index) => (None, index.parameters, index.type_node),
            MemberData::GetAccessor(accessor) => (
                accessor.type_parameters,
                accessor.parameters,
                accessor.type_node,
            ),
            MemberData::SetAccessor(accessor) => (
                accessor.type_parameters,
                accessor.parameters,
                accessor.type_node,
            ),
        };
        signature(type_parameters, parameters, returns, lines);
    }
}

/// What is read from the start of a text: its outline, how many errors the log has, and the token and the offset that the lexer is on after it.
type Read = (String, u32, T, usize);

/// What `read` builds from the start of `text`. `None`: it returns an error.
fn read_from<E>(
    text: &'static [u8],
    read: impl FnOnce(&mut P<'_, true, false>) -> Result<ts::Type, E>,
) -> Option<Read> {
    let found = with_parser(text, |p| {
        let node = read(p).ok()?;
        let mut lines = Vec::new();
        outline(node, &mut lines);
        Some((
            lines.join(" "),
            p.log().errors,
            p.lexer.token,
            p.lexer.start,
        ))
    });
    found.flatten()
}

/// The type that `text` starts with.
fn type_read(text: &'static [u8]) -> Option<Read> {
    read_from(text, |p| p.build_type_script_type(Level::Lowest))
}

/// Every text is one type: the outline is the one of `type T = <text>;`.
const TYPES: &[(&[u8], &str)] = &[
    (b"any", "AnyKeyword[0,3)"),
    (b"string[]", "ArrayType[0,8) StringKeyword[0,6)"),
    (b"A.B.C", "TypeReference[0,5)"),
    (
        b"A<B, C>",
        "TypeReference[0,7)<2,6> TypeReference[2,3) TypeReference[5,6)",
    ),
    (
        b"A | B & C",
        "UnionType[0,9) TypeReference[0,1) IntersectionType[4,9) TypeReference[4,5) TypeReference[8,9)",
    ),
    (
        b"| A | B",
        "UnionType[0,7) TypeReference[2,3) TypeReference[6,7)",
    ),
    (
        b"A | B extends C ? D : E",
        "ConditionalType[0,23) UnionType[0,5) TypeReference[0,1) TypeReference[4,5) TypeReference[14,15) TypeReference[18,19) TypeReference[22,23)",
    ),
    (
        b"T extends (infer U)[] ? U : never",
        "ConditionalType[0,33) TypeReference[0,1) ArrayType[10,21) ParenthesizedType[10,19) InferType[11,18) TypeReference[24,25) NeverKeyword[28,33)",
    ),
    (
        b"keyof A[]",
        "TypeOperator[0,9) ArrayType[6,9) TypeReference[6,7)",
    ),
    (
        b"readonly string[]",
        "TypeOperator[0,17) ArrayType[9,17) StringKeyword[9,15)",
    ),
    (b"unique symbol", "TypeOperator[0,13) SymbolKeyword[7,13)"),
    (
        b"typeof a.b<C>",
        "TypeQuery[0,13)<11,12> TypeReference[11,12)",
    ),
    (
        b"A[\"k\"][number]",
        "IndexedAccessType[0,14) IndexedAccessType[0,6) TypeReference[0,1) LiteralType[2,5) NumberKeyword[7,13)",
    ),
    (
        b"[a: A, b?: B, ...c: C[]]",
        "TupleType[0,24) NamedTupleMember[1,5) TypeReference[4,5) NamedTupleMember[7,12) TypeReference[11,12) NamedTupleMember[14,23) ArrayType[20,23) TypeReference[20,21)",
    ),
    (
        b"[A?, ...B[]]",
        "TupleType[0,12) OptionalType[1,3) TypeReference[1,2) RestType[5,11) ArrayType[8,11) TypeReference[8,9)",
    ),
    (
        b"(a: A, b?: B) => C",
        "FunctionType[0,18) TypeReference[4,5) TypeReference[11,12) TypeReference[17,18)",
    ),
    (b"new () => A", "ConstructorType[0,11) TypeReference[10,11)"),
    (
        b"abstract new <T>() => A",
        "ConstructorType[0,23){14,15} TypeReference[22,23)",
    ),
    (
        b"{ a: A; b?: B; (c: C): D; new (e: E): F; [k: string]: G; m<T>(x: T): void }",
        "TypeLiteral[0,75) TypeReference[5,6) TypeReference[12,13) TypeReference[19,20) TypeReference[23,24) TypeReference[34,35) TypeReference[38,39) StringKeyword[45,51) TypeReference[54,55) TypeReference[65,66) VoidKeyword[69,73)",
    ),
    (
        b"{ readonly [K in keyof T]?: T[K] }",
        "MappedType[0,34) TypeOperator[17,24) TypeReference[23,24) IndexedAccessType[28,32) TypeReference[28,29) TypeReference[30,31)",
    ),
    (
        b"{ [K in T as U]: V }",
        "MappedType[0,20) TypeReference[8,9) TypeReference[13,14) TypeReference[17,18)",
    ),
    (
        b"`a${B}c${D}`",
        "TemplateLiteralType[0,12) TypeReference[4,5) TypeReference[9,10)",
    ),
    (
        b"import(\"m\").A<B>",
        "ImportType[0,16)<14,15> LiteralType[7,10) TypeReference[14,15)",
    ),
    (
        b"typeof import(\"m\")",
        "ImportType[0,18) LiteralType[14,17)",
    ),
    (b"(A)", "ParenthesizedType[0,3) TypeReference[1,2)"),
    (
        b"\"s\" | 1 | -1 | 1n | true | null | undefined | void | this",
        "UnionType[0,57) LiteralType[0,3) LiteralType[6,7) LiteralType[10,12) LiteralType[15,17) LiteralType[20,24) LiteralType[27,31) UndefinedKeyword[34,43) VoidKeyword[46,50) ThisType[53,57)",
    ),
];

#[test]
fn a_type_is_the_nodes_that_tsc_builds() {
    let mut failed = Vec::new();
    for &(text, expected) in TYPES {
        let found = type_read(text).map(|(outline, errors, token, _)| (outline, errors, token));
        if found != Some((expected.to_owned(), 0, T::TEndOfFile)) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

/// Every text closes type arguments or type parameters with the first character of a longer token: the outline, and the offset after the type.
const SPLIT_CLOSERS: &[(&[u8], &str, usize)] = &[
    (
        b"A<B<C>>",
        "TypeReference[0,7)<2,6> TypeReference[2,6)<4,5> TypeReference[4,5)",
        7,
    ),
    (
        b"A<B<C<D>>>",
        "TypeReference[0,10)<2,9> TypeReference[2,9)<4,8> TypeReference[4,8)<6,7> TypeReference[6,7)",
        10,
    ),
    (b"A<B>= 1", "TypeReference[0,4)<2,3> TypeReference[2,3)", 4),
    (
        b"A<B<C>>= 1",
        "TypeReference[0,7)<2,6> TypeReference[2,6)<4,5> TypeReference[4,5)",
        7,
    ),
    (
        b"A<B<C<D>>>= 1",
        "TypeReference[0,10)<2,9> TypeReference[2,9)<4,8> TypeReference[4,8)<6,7> TypeReference[6,7)",
        10,
    ),
    (
        b"<T extends A<B>>(a: T) => void",
        "FunctionType[0,30){1,15} TypeReference[11,15)<13,14> TypeReference[13,14) TypeReference[20,21) VoidKeyword[26,30)",
        30,
    ),
];

#[test]
fn a_closer_inside_a_longer_token_ends_its_list_and_no_more() {
    let mut failed = Vec::new();
    for &(text, expected, end) in SPLIT_CLOSERS {
        let after = if end == text.len() {
            T::TEndOfFile
        } else {
            T::TEquals
        };
        let found = type_read(text);
        if found != Some((expected.to_owned(), 0, after, end)) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

/// Every text is what follows the `:` of `function f(x: any): <text> {}`.
const RETURN_TYPES: &[(&[u8], &str)] = &[
    (b"x is T", "TypePredicate[0,6) TypeReference[5,6)"),
    (b"asserts x", "TypePredicate[0,9)"),
    (
        b"asserts x is T",
        "TypePredicate[0,14) TypeReference[13,14)",
    ),
    (
        b"this is T",
        "TypePredicate[0,9) ThisType[0,4) TypeReference[8,9)",
    ),
    (
        b"asserts this is T",
        "TypePredicate[0,17) ThisType[8,12) TypeReference[16,17)",
    ),
    (b"A<B>", "TypeReference[0,4)<2,3> TypeReference[2,3)"),
];

#[test]
fn a_return_type_is_a_type_or_a_predicate() {
    let mut failed = Vec::new();
    for &(text, expected) in RETURN_TYPES {
        let found = read_from(text, |p| p.build_typescript_return_type());
        if found != Some((expected.to_owned(), 0, T::TEndOfFile, text.len())) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

/// The range of the list that `text` is, the name and the range of each type parameter, and the offset after the `>`.
fn type_parameters_read(text: &'static [u8]) -> Option<(String, u32)> {
    let found = with_parser(text, |p| {
        let (list, close_end) = p.build_type_script_type_parameters().ok()??;
        let mut line = format!("{{{},{}}}", list.start, list.end);
        for parameter in list.iter() {
            let name = bstr::BStr::new(parameter.name.text.slice());
            line.push_str(&format!(" {name}[{},{})", parameter.start, parameter.end));
        }
        (p.lexer.token == T::TEndOfFile).then_some((line, close_end))
    });
    found.flatten()
}

#[test]
fn type_parameters_end_at_their_closer() {
    let cases: [(&'static [u8], &str); 5] = [
        (b"<T>", "{1,2} T[1,2)"),
        (b"<T, U>", "{1,5} T[1,2) U[4,5)"),
        (b"<T extends A<B>>", "{1,15} T[1,15)"),
        (b"<T = A<B<C>>>", "{1,12} T[1,12)"),
        (
            b"<in out T, const U extends V = W,>",
            "{1,33} T[1,9) U[11,32)",
        ),
    ];
    for (text, expected) in cases {
        let found = type_parameters_read(text);
        let expected = Some((expected.to_owned(), text.len() as u32));
        assert_eq!(found, expected, "{}", bstr::BStr::new(text));
    }
    assert_eq!(type_parameters_read(b"T"), None);
}

#[test]
fn a_token_that_starts_no_type_is_an_error() {
    assert_eq!(type_read(b")"), None);
    assert_eq!(type_read(b"A<"), None);
}
