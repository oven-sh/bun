//! GraphQL for `Bun.highlight`: the tokens and the tree of [`parser::parse_tolerant`], which takes broken code too.

use super::parser::{self, Kind, TokenKind, Tree, read_escape};
use crate::highlight::{Spans, Token};
use bun_core::strings;

/// A node of this kind is exactly one token.
fn is_leaf(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::Name
            | Kind::IntValue
            | Kind::FloatValue
            | Kind::StringValue
            | Kind::BooleanValue
            | Kind::NullValue
            | Kind::EnumValue
    )
}

/// What a `Name` right in a node of `parent` is.
fn name_in(parent: Kind) -> Token {
    match parent {
        Kind::OperationDefinition | Kind::FragmentDefinition | Kind::FragmentSpread => {
            Token::Function
        }
        Kind::Variable => Token::Variable,
        Kind::Argument | Kind::FragmentArgument => Token::VariableParameter,
        Kind::Directive | Kind::DirectiveExtension => Token::Decorator,
        // The name of the directive follows an `@`. The others are locations: `on FIELD | QUERY`.
        Kind::DirectiveDefinition | Kind::EnumValueDefinition => Token::Constant,
        Kind::NamedType
        | Kind::ScalarTypeDefinition
        | Kind::ObjectTypeDefinition
        | Kind::InterfaceTypeDefinition
        | Kind::UnionTypeDefinition
        | Kind::EnumTypeDefinition
        | Kind::InputObjectTypeDefinition
        | Kind::ScalarTypeExtension
        | Kind::ObjectTypeExtension
        | Kind::InterfaceTypeExtension
        | Kind::UnionTypeExtension
        | Kind::EnumTypeExtension
        | Kind::InputObjectTypeExtension => Token::Type,
        _ => Token::Property,
    }
}

/// The token for each node of `tree` that is a leaf.
fn tokens_of_leaves(tree: &Tree) -> Vec<Token> {
    let mut tokens = vec![Token::Property; tree.nodes.len()];
    let mut set = |id: parser::NodeId, token: Token| {
        if let Some(slot) = tokens.get_mut(id as usize) {
            *slot = token;
        }
    };
    // A parent comes after its children, so what it says about them is what stays.
    for (id, node) in tree.nodes.iter().enumerate() {
        let id = id as parser::NodeId;
        match node.kind {
            Kind::IntValue | Kind::FloatValue => set(id, Token::Number),
            Kind::StringValue => set(id, Token::String),
            Kind::BooleanValue => set(id, Token::Boolean),
            Kind::NullValue => set(id, Token::ConstantBuiltin),
            Kind::EnumValue => set(id, Token::Constant),
            _ => {}
        }
        let has_values = matches!(
            node.kind,
            Kind::Argument | Kind::FragmentArgument | Kind::ObjectField | Kind::ListValue
        );
        let has_parameters = matches!(node.kind, Kind::FieldDefinition | Kind::DirectiveDefinition);
        for (index, &child) in tree.children(id).iter().enumerate() {
            match tree.kind(child) {
                Kind::Name => set(child, name_in(node.kind)),
                // A description.
                Kind::StringValue if index == 0 && !has_values => set(child, Token::CommentDoc),
                // `a(b: Int): Int`. In `input A { b: Int }`, `b` is a field.
                Kind::InputValueDefinition if has_parameters => {
                    for &inner in tree.children(child) {
                        if tree.kind(inner) == Kind::Name {
                            set(inner, Token::VariableParameter);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    tokens
}

fn is_keyword(name: &[u8]) -> bool {
    parser::starts_definition(name) || matches!(name, b"on" | b"implements" | b"repeatable")
}

/// The escapes in the string from `start` to `end`.
fn add_escapes(code: &[u8], start: u32, end: u32, is_block: bool, spans: &mut Spans) {
    let Some(text) = code.get(..end as usize) else {
        return;
    };
    let mut at = start as usize;
    while let Some(found) = text
        .get(at..)
        .and_then(|rest| strings::index_of_char_usize(rest, b'\\'))
    {
        at += found;
        let rest = text.get(at..).unwrap_or_default();
        let len = match is_block {
            // Nothing else is an escape in a block string.
            true => rest.starts_with(b"\\\"\"\"").then_some(4),
            false => read_escape(rest).map(|(_, len)| len),
        };
        if let Some(len) = len {
            spans.add_range(at..at + len, Token::StringEscape);
        }
        at += len.unwrap_or(1);
    }
}

pub(crate) fn highlight(code: &[u8], spans: &mut Spans) {
    let (mut tree, mut tokens) = (Tree::default(), Vec::new());
    parser::parse_tolerant(code, &mut tree, &mut tokens);
    let leaves = tokens_of_leaves(&tree);
    // Leaves are in `tree.nodes` in source order, like the tokens.
    let mut node = 0;
    let mut index = 0;
    let mut depth = 0usize;
    while let Some(&parser::Token {
        kind,
        mut start,
        mut end,
    }) = tokens.get(index)
    {
        index += 1;
        let token = match kind {
            TokenKind::StartOfFile | TokenKind::EndOfFile => continue,
            TokenKind::Comment => Token::Comment,
            TokenKind::Bang
            | TokenKind::Amp
            | TokenKind::Spread
            | TokenKind::Equals
            | TokenKind::Pipe => Token::Operator,
            TokenKind::ParenL | TokenKind::BracketL | TokenKind::BraceL => {
                depth += 1;
                Token::PunctuationBracket
            }
            TokenKind::ParenR | TokenKind::BracketR | TokenKind::BraceR => {
                depth = depth.saturating_sub(1);
                Token::PunctuationBracket
            }
            TokenKind::Colon | TokenKind::Comma => Token::PunctuationDelimiter,
            TokenKind::Dollar | TokenKind::At => {
                let token = match kind {
                    TokenKind::Dollar => Token::Variable,
                    _ => Token::Decorator,
                };
                // `$id` and `@skip` are one span each.
                if let Some(name) = tokens.get(index)
                    && name.kind == TokenKind::Name
                {
                    index += 1;
                    if name.start > end {
                        spans.add(start, end, token);
                        start = name.start;
                    }
                    end = name.end;
                }
                token
            }
            TokenKind::Name
            | TokenKind::Int
            | TokenKind::Float
            | TokenKind::String
            | TokenKind::BlockString => {
                while tree
                    .nodes
                    .get(node)
                    .is_some_and(|it| it.span.start < start || !is_leaf(it.kind))
                {
                    node += 1;
                }
                let text = code.get(start as usize..end as usize).unwrap_or_default();
                let leaf = tree.nodes.get(node).filter(|it| it.span.start == start);
                match (leaf.and_then(|_| leaves.get(node)), kind) {
                    (Some(Token::Type), _)
                        if matches!(text, b"Int" | b"Float" | b"String" | b"Boolean" | b"ID") =>
                    {
                        Token::TypeBuiltin
                    }
                    (Some(&token), _) => token,
                    // The parser makes no node of a keyword, nor of a token that it skips.
                    (None, TokenKind::Name) if is_keyword(text) => Token::Keyword,
                    (None, TokenKind::Name) => continue,
                    (None, TokenKind::Int | TokenKind::Float) => Token::Number,
                    // A description whose definition hasn't been typed yet.
                    (None, _) if depth == 0 => Token::CommentDoc,
                    (None, _) => Token::String,
                }
            }
        };
        spans.add(start, end, token);
        if token == Token::String {
            add_escapes(code, start, end, kind == TokenKind::BlockString, spans);
        }
    }
}
