//! Which properties the nodes of each type have, in which order: what the parser of the real tool makes. Rules go through
//! `Object.keys(node)`, spread nodes and print them as JSON.
//!
//! - espree: `type`, `start`, `end`, `loc`, `range`, the fields in the order in which acorn sets them, `parent`.
//! - typescript-estree: `type`, the fields by their names, the deprecated ones, `range`, `loc`, `parent`. Where its converter works
//!   out the range itself, `range` comes right after `type`: see [`alternates`].
//! - oxlint: `type`, the fields in the order of oxc's structs, `start`, `end`, `range`, `parent`. `loc` is inherited. A JavaScript
//!   file has the same nodes as a TypeScript file, and what isn't there is `null`.
//!
//! The orders were read off the nodes that espree 11, typescript-estree 8.71.1 and oxlint 1.87 make of 63,000 files.

use super::ast::{self, STRINGS};
use super::wire;
use crate::code_path::estree::Tree;
use crate::estree::{Field, NodeType, Value};
use crate::utils::sort;
use bun_core::strings;
use rustc_hash::FxHashMap;

/// What is in a property of a node, if it isn't a field: the number of a field is below these.
const TYPE: u32 = 0xF0;
const START: u32 = 0xF1;
const END: u32 = 0xF2;
const RANGE: u32 = 0xF3;
const PARENT: u32 = 0xF4;
const LOC: u32 = 0xF5;
const UNDEFINED: u32 = 0xF6;
/// `comments` and `tokens` of the `Program`.
const COMMENTS: u32 = 0xF7;
const TOKENS: u32 = 0xF8;
/// A getter and a setter from `worker/ast.js`, which aren't enumerable.
const DEPRECATED: u32 = 0xF9;
const FALSE: u32 = 0xFA;
/// An array of its own for each node, which is made when it's first read.
const EMPTY_LIST: u32 = 0xFB;
/// `"value"`, of `importKind` and `exportKind`.
const VALUE: u32 = 0xFC;

/// The types whose fields aren't in the order that the rule for the tool gives, each with its fields.
const TYPESCRIPT: &[u8] = b"\
    AssignmentExpression:operator,left,right;\
    AssignmentPattern:decorators,left,optional,right,typeAnnotation;BinaryExpression:operator,left,right;\
    ClassBody:body;\
    ExportNamedDeclaration:attributes,declaration,exportKind,source,specifiers,assertions;\
    FunctionExpression:async,body,declare,expression,generator,id,params,returnType,typeParameters;\
    ImportDefaultSpecifier:local;JSXText:raw,value;LogicalExpression:operator,left,right;\
    Program:body,comments,sourceType,tokens;RestElement:argument,decorators,optional,typeAnnotation,value;\
    TSEmptyBodyFunctionExpression:async,body,declare,expression,generator,id,params,returnType,typeParameters;\
    TSEnumBody:members;TSEnumMember:id,initializer,computed;TSImportType:options,qualifier,source,typeArguments,argument;\
    TSInterfaceBody:body;TSTypeAnnotation:typeAnnotation;TSTypeParameterDeclaration:params;\
    TSTypeParameterInstantiation:params;\
";

const ESPREE: &[u8] = b"\
    ArrowFunctionExpression:id,expression,generator,async,params,body;AssignmentExpression:operator,left,right;\
    BinaryExpression:left,operator,right;ForOfStatement:await,left,right,body;\
    FunctionDeclaration:id,expression,generator,async,params,body;\
    FunctionExpression:id,expression,generator,async,params,body;\
    JSXElement:openingElement,closingElement,children;JSXFragment:openingFragment,closingFragment,children;\
    JSXOpeningElement:attributes,name,selfClosing;JSXText:value,raw,bigint;LabeledStatement:body,label;\
    Literal:value,raw,bigint,regex;LogicalExpression:left,operator,right;\
    MethodDefinition:static,computed,key,kind,value;Program:body,sourceType,comments,tokens;\
    Property:method,shorthand,computed,key,value,kind;PropertyDefinition:static,computed,key,value;\
    SwitchCase:consequent,test;TemplateElement:value,tail;TemplateLiteral:expressions,quasis;\
    UnaryExpression:operator,prefix,argument;UpdateExpression:operator,prefix,argument;\
    YieldExpression:delegate,argument;\
";

const OXLINT: &[u8] = b"\
    \
    AccessorProperty:decorators,key,typeAnnotation,value,computed,static,override,definite,accessibility,declare,optional,readonly;\
    ArrayPattern:decorators,elements,optional,typeAnnotation;\
    ArrowFunctionExpression:expression,async,typeParameters,params,returnType,body,id,generator;\
    AssignmentExpression:operator,left,right;AssignmentPattern:decorators,left,right,optional,typeAnnotation;\
    BinaryExpression:left,operator,right;\
    ExportNamedDeclaration:declaration,specifiers,source,exportKind,attributes;\
    ForOfStatement:await,left,right,body;\
    FunctionDeclaration:id,generator,async,declare,typeParameters,params,returnType,body,expression;\
    FunctionExpression:id,generator,async,declare,typeParameters,params,returnType,body,expression;\
    Identifier:decorators,name,optional,typeAnnotation;\
    ImportDeclaration:specifiers,source,phase,attributes,importKind;JSXOpeningFragment:;JSXText:value,raw;\
    Literal:value,raw,bigint,regex;LogicalExpression:left,operator,right;\
    MemberExpression:object,property,optional,computed;\
    MethodDefinition:decorators,key,value,kind,computed,static,override,optional,accessibility;\
    ObjectPattern:decorators,properties,optional,typeAnnotation;Program:body,sourceType,comments,tokens;\
    Property:kind,key,value,method,shorthand,computed,optional;\
    PropertyDefinition:decorators,key,typeAnnotation,value,computed,static,declare,override,optional,definite,readonly,accessibility;\
    RestElement:decorators,argument,optional,typeAnnotation,value;\
    TSAbstractAccessorProperty:decorators,key,typeAnnotation,value,computed,static,override,definite,accessibility,declare,optional,readonly;\
    TSAbstractMethodDefinition:decorators,key,value,kind,computed,static,override,optional,accessibility;\
    TSAbstractPropertyDefinition:decorators,key,typeAnnotation,value,computed,static,declare,override,optional,definite,readonly,accessibility;\
    TSConstructorType:abstract,typeParameters,params,returnType;\
    TSDeclareFunction:id,generator,async,declare,typeParameters,params,returnType,body,expression;\
    TSEmptyBodyFunctionExpression:id,generator,async,declare,typeParameters,params,returnType,body,expression;\
    TSEnumMember:id,initializer,computed;\
    TSIndexSignature:parameters,typeAnnotation,readonly,static,accessibility;\
    TSMethodSignature:key,computed,optional,kind,typeParameters,params,returnType,accessibility,readonly,static;\
    TSModuleDeclaration:id,body,kind,declare,global;\
    TSParameterProperty:accessibility,decorators,override,parameter,readonly,static;\
    TSPropertySignature:computed,optional,readonly,key,typeAnnotation,accessibility,static;\
    TSTypeOperator:operator,typeAnnotation;TSTypeParameter:name,constraint,default,in,out,const;\
    TSTypePredicate:parameterName,asserts,typeAnnotation;TemplateElement:value,tail;\
    UnaryExpression:operator,argument,prefix;UpdateExpression:operator,prefix,argument;\
    VariableDeclaration:kind,declarations,declare;YieldExpression:delegate,argument;\
";

#[derive(Copy, Clone, PartialEq, Eq)]
enum Layout {
    TypeScript,
    Espree,
    Oxlint,
    /// The same nodes, in a JavaScript file. More than a third of all properties are ones that only TypeScript can fill in: the
    /// decorators, the `?` and the type of an `Identifier`, the type arguments of a call. `ast.rs` writes nothing about these:
    /// [`ast::shortens_nodes`].
    OxlintJavaScript,
}

impl Layout {
    const ALL: [Layout; 4] = [
        Layout::TypeScript,
        Layout::Espree,
        Layout::Oxlint,
        Layout::OxlintJavaScript,
    ];

    /// The tree is that of espree.
    fn is_espree(self) -> bool {
        self == Layout::Espree
    }

    fn is_oxlint(self) -> bool {
        matches!(self, Layout::Oxlint | Layout::OxlintJavaScript)
    }

    fn exceptions(self) -> &'static [u8] {
        match self {
            Layout::TypeScript => TYPESCRIPT,
            Layout::Espree => ESPREE,
            Layout::Oxlint | Layout::OxlintJavaScript => OXLINT,
        }
    }
}

/// The name of a property, and what is in it.
type Property = (&'static [u8], u32);

const TYPE_PROPERTY: Property = (b"type", TYPE);
const START_PROPERTY: Property = (b"start", START);
const END_PROPERTY: Property = (b"end", END);
const RANGE_PROPERTY: Property = (b"range", RANGE);
const PARENT_PROPERTY: Property = (b"parent", PARENT);
const LOC_PROPERTY: Property = (b"loc", LOC);

/// Names, each once, one after the other.
#[derive(Default)]
struct Names {
    bytes: Vec<u8>,
    known: FxHashMap<&'static [u8], u32>,
}

impl Names {
    /// Where `name` starts, above its length in the low 8 bits.
    fn add(&mut self, name: &'static [u8]) -> u32 {
        *self.known.entry(name).or_insert_with(|| {
            let start = self.bytes.len() as u32;
            self.bytes.extend_from_slice(name);
            start << 8 | name.len() as u32
        })
    }
}

/// A node doesn't have the field at all if there is nothing to say, where the others are `undefined`: rules ask whether a `Literal`
/// has a `regex`. espree also leaves out the `directive` of a statement that is none.
fn can_be_left_out(node_type: NodeType, field: Field, is_espree: bool) -> bool {
    matches!(
        (node_type, field),
        (NodeType::Literal, Field::Regex | Field::Bigint)
            | (NodeType::JSXText, Field::Bigint)
            | (NodeType::TSModuleDeclaration, Field::Body)
    ) || (is_espree && field == Field::Directive)
}

/// The properties between `type` and what all nodes end with: a name and what is in it for each. `fields`: the names of the fields
/// that `ast.rs` writes, in its order. `hidden`: those of the deprecated ones. `shown`: `fields`, and in between them those that
/// `ast.rs` leaves out because the type [`ast::is_short`].
fn fields_in_order(
    layout: Layout,
    listed: Option<&'static [u8]>,
    fields: &[&'static [u8]],
    hidden: &[&'static [u8]],
    shown: &[&'static [u8]],
) -> Vec<Property> {
    let is_short = shown.len() != fields.len();
    let what = |name: &'static [u8]| match fields.iter().position(|it| *it == name) {
        Some(field) if !hidden.contains(&name) => field as u32,
        Some(_) => DEPRECATED,
        None if name == b"comments" => COMMENTS,
        None if name == b"tokens" => TOKENS,
        None if hidden.contains(&name) => DEPRECATED,
        None if is_short && name == b"decorators" => EMPTY_LIST,
        None if is_short && matches!(name, b"optional" | b"definite" | b"declare") => FALSE,
        None if is_short && matches!(name, b"importKind" | b"exportKind") => VALUE,
        None => UNDEFINED,
    };
    if let Some(listed) = listed {
        let names = strings::split(listed, b",").filter(|it| !it.is_empty());
        return names.map(|it| (it, what(it))).collect();
    }
    let mut names = shown.to_vec();
    names.retain(|it| !hidden.contains(it));
    if layout == Layout::TypeScript {
        sort::sort_by_cached_key(&mut names, |it| it.to_ascii_lowercase());
        names.extend_from_slice(hidden);
    }
    names.into_iter().map(|it| (it, what(it))).collect()
}

/// In the place of the number of a type that nothing here makes: `u32::MAX` less what its visitor keys are. The order is that of
/// `keysOfOtherTypes` in src/jsc/bindings/LintNodes.cpp.
const ARGUMENT: u32 = 0;
const NO_KEYS: u32 = 1;
const EXPRESSION: u32 = 2;
const TYPE_ANNOTATION: u32 = 3;
const NAME_AND_ARGUMENTS: u32 = 4;

/// The types in the order of `sourceCode.visitorKeys`, each with its number. eslint-visitor-keys has its types by their names.
/// typescript-eslint adds its own to these, by their names without regard to case. Both still have two types that nothing makes
/// any more.
fn visitor_key_order(layout: Layout) -> Vec<(&'static [u8], u32)> {
    let all = (NodeType::ALL.iter().enumerate()).map(|(i, it)| (it.name().as_bytes(), i as u32));
    if layout == Layout::Oxlint {
        return visitor_key_order_of_oxlint(all.collect());
    }
    let (mut typescript, mut espree): (Vec<_>, Vec<_>) = all.partition(|(name, _)| {
        name.starts_with(b"TS") || *name == b"AccessorProperty" || *name == b"Decorator"
    });
    espree.push((b"ExperimentalRestProperty", u32::MAX - ARGUMENT));
    espree.push((b"ExperimentalSpreadProperty", u32::MAX - ARGUMENT));
    espree.sort_unstable();
    if layout == Layout::TypeScript {
        sort::sort_by_cached_key(&mut typescript, |(name, _)| name.to_ascii_lowercase());
        espree.append(&mut typescript);
    }
    espree
}

/// oxlint has the types without keys first. Then come those of JavaScript, of JSX and of TypeScript, by their names. It lacks the
/// keywords that typescript-estree no longer makes nodes of, and has six types that it makes no nodes of.
fn visitor_key_order_of_oxlint(mut all: Vec<(&'static [u8], u32)>) -> Vec<(&'static [u8], u32)> {
    all.retain(|(name, _)| {
        !matches!(
            *name,
            b"TSAbstractKeyword"
                | b"TSAsyncKeyword"
                | b"TSDeclareKeyword"
                | b"TSExportKeyword"
                | b"TSPrivateKeyword"
                | b"TSProtectedKeyword"
                | b"TSPublicKeyword"
                | b"TSReadonlyKeyword"
                | b"TSStaticKeyword"
        )
    });
    all.extend_from_slice(&[
        (&b"ParenthesizedExpression"[..], u32::MAX - EXPRESSION),
        (&b"TSJSDocNonNullableType"[..], u32::MAX - TYPE_ANNOTATION),
        (&b"TSJSDocNullableType"[..], u32::MAX - TYPE_ANNOTATION),
        (&b"TSJSDocUnknownType"[..], u32::MAX - NO_KEYS),
        (&b"TSParenthesizedType"[..], u32::MAX - TYPE_ANNOTATION),
        (&b"V8IntrinsicExpression"[..], u32::MAX - NAME_AND_ARGUMENTS),
    ]);
    let has_keys = |number: u32| match NodeType::ALL.get(number as usize) {
        Some(it) => {
            let mut fields = it.fields().iter();
            fields.any(|it| it.is_child && !it.is_hidden && !it.is_espree_only)
        }
        None => number != u32::MAX - NO_KEYS,
    };
    sort::sort_by_cached_key(&mut all, |&(name, number)| {
        let group = match name {
            [b'J', b'S', b'X', ..] => 1,
            [b'T', b'S', ..] => 2,
            _ => 0,
        };
        (has_keys(number), group, name)
    });
    all
}

/// For src/jsc/bindings/LintNodes.cpp.
///
/// Words: how many types there are, how many of [`STRINGS`], how many words come before the names, how many layouts there are, how
/// many words [`visitor_key_order`] takes. Then
/// for each type its name, and for each layout: how many fields `ast.rs` writes for a node, a bit for each field that is a visitor
/// key, a bit for each field that can be left out, how many properties there are, how many in the other order that [`alternates`] is
/// about, then a name and what is in it for each property, in both orders. Then [`STRINGS`]. Then for each of the first three layouts
/// what [`visitor_key_order`] returns, behind its length. Then the bytes of the names. A name is where it starts in these,
/// above its length in the low 8 bits.
pub(super) fn write(out: &mut Vec<u8>) {
    let mut names = Names::default();
    let mut words = vec![
        NodeType::ALL.len() as u32,
        STRINGS.len() as u32,
        0,
        Layout::ALL.len() as u32,
        0,
    ];
    let exceptions = Layout::ALL.map(|layout| -> FxHashMap<&[u8], &[u8]> {
        let all = strings::split(layout.exceptions(), b";");
        all.filter_map(|it| strings::split_once_char(it, b':'))
            .collect()
    });
    for &node_type in NodeType::ALL {
        words.push(names.add(node_type.name().as_bytes()));
        for (layout, exceptions) in Layout::ALL.into_iter().zip(&exceptions) {
            let is_espree = layout.is_espree();
            let is_short = layout == Layout::OxlintJavaScript && ast::is_short(node_type);
            let (mut fields, mut hidden, mut shown) = (Vec::new(), Vec::new(), Vec::new());
            let (mut children, mut left_out) = (0, 0);
            for it in node_type.fields() {
                if it.is_hidden {
                    hidden.push(it.field.name().as_bytes());
                }
                let is_shown = !it.is_hidden
                    && !(if is_espree {
                        it.is_typescript_only
                    } else {
                        it.is_espree_only
                    });
                if is_shown {
                    shown.push(it.field.name().as_bytes());
                }
                if is_shown && !(is_short && it.is_typescript_only) {
                    let bit = 1 << fields.len();
                    children |= u32::from(it.is_child) * bit;
                    left_out |= u32::from(can_be_left_out(node_type, it.field, is_espree)) * bit;
                    fields.push(it.field.name().as_bytes());
                }
            }
            // Only oxlint has it as a plain property.
            if node_type == NodeType::TSEnumMember && !layout.is_oxlint() {
                hidden.push(Field::Computed.name().as_bytes());
            }
            let listed = exceptions.get(node_type.name().as_bytes()).copied();
            let middle = fields_in_order(layout, listed, &fields, &hidden, &shown);
            let around: (&[Property], &[Property]) = match layout {
                Layout::Espree => (
                    &[
                        TYPE_PROPERTY,
                        START_PROPERTY,
                        END_PROPERTY,
                        LOC_PROPERTY,
                        RANGE_PROPERTY,
                    ],
                    &[PARENT_PROPERTY],
                ),
                Layout::TypeScript => (
                    &[TYPE_PROPERTY],
                    &[RANGE_PROPERTY, LOC_PROPERTY, PARENT_PROPERTY],
                ),
                Layout::Oxlint | Layout::OxlintJavaScript => (
                    &[TYPE_PROPERTY],
                    &[
                        START_PROPERTY,
                        END_PROPERTY,
                        RANGE_PROPERTY,
                        PARENT_PROPERTY,
                    ],
                ),
            };
            let properties: Vec<Property> = [around.0, &middle[..], around.1].concat();
            let alternate: Vec<Property> = match (layout, node_type) {
                (Layout::TypeScript, NodeType::TSModuleDeclaration) => {
                    let order = b"kind,body,declare,global,id";
                    let middle = fields_in_order(layout, Some(order), &fields, &hidden, &shown);
                    [around.0, &middle[..], around.1].concat()
                }
                // `convertTypeAnnotation` and `convertTSTypeParametersToTypeParametersDeclaration` work out both.
                (
                    Layout::TypeScript,
                    NodeType::TSTypeAnnotation | NodeType::TSTypeParameterDeclaration,
                ) => [
                    &[TYPE_PROPERTY, LOC_PROPERTY, RANGE_PROPERTY],
                    &middle[..],
                    &[PARENT_PROPERTY],
                ]
                .concat(),
                (Layout::TypeScript, _) => [
                    &[TYPE_PROPERTY, RANGE_PROPERTY],
                    &middle[..],
                    &[LOC_PROPERTY, PARENT_PROPERTY],
                ]
                .concat(),
                _ => Vec::new(),
            };
            words.extend_from_slice(&[
                fields.len() as u32,
                children,
                left_out,
                properties.len() as u32,
                alternate.len() as u32,
            ]);
            for (name, what) in properties.into_iter().chain(alternate) {
                words.extend_from_slice(&[names.add(name), what]);
            }
        }
    }
    words.extend(STRINGS.iter().map(|it| names.add(it.as_bytes())));
    let before = words.len();
    for layout in [Layout::TypeScript, Layout::Espree, Layout::Oxlint] {
        let order = visitor_key_order(layout);
        words.push(order.len() as u32);
        for (name, node_type) in order {
            words.extend_from_slice(&[names.add(name), node_type]);
        }
    }
    words[4] = (words.len() - before) as u32;
    words[2] = words.len() as u32;
    wire::words(out, &words);
    out.extend_from_slice(&names.bytes);
}

/// The nodes of a tree of typescript-estree whose properties are in the other order, in ascending order. These are the nodes for which
/// its converter passes a `range` of its own to `createNode`, which puts it right after `type`, and the declarations of modules
/// with a name in quotes, where `kind` comes first.
pub(super) fn alternates(tree: Tree) -> Vec<u32> {
    let type_of = |id: u32| {
        NodeType::ALL
            .get(usize::from(*tree.types.get(id as usize)?))
            .copied()
    };
    let field = |id: u32, field: Field| {
        (tree.nodes.get(id as usize)).map_or(Value::Undefined, |it| it.field(field))
    };
    let is_in = |id: u32, parent: u32, name: Field| matches!((field(parent, name), tree.nodes.get(id as usize)), (Value::Node(node), Some(&it)) if node == it);
    let is_true = |value: Value| matches!(value, Value::Bool(true));
    // Whether the pattern `id` declares what is in it, and isn't assigned to.
    let is_binding = |mut id: u32| loop {
        let parent = tree.parents[id as usize];
        match type_of(parent) {
            Some(
                NodeType::ArrayPattern
                | NodeType::ObjectPattern
                | NodeType::RestElement
                | NodeType::Property
                | NodeType::AssignmentPattern,
            ) if parent != id => id = parent,
            Some(
                NodeType::AssignmentExpression
                | NodeType::ForInStatement
                | NodeType::ForOfStatement
                | NodeType::ObjectExpression
                | NodeType::ArrayExpression,
            ) => {
                return false;
            }
            _ => return true,
        }
    };
    // `{ with: { .. } }` in `import("a", { with: { .. } })` as a type.
    let is_options = |id: u32| {
        type_of(id) == Some(NodeType::ObjectExpression)
            && type_of(tree.parents[id as usize]) == Some(NodeType::TSImportType)
    };
    let is_alternate = |id: u32, node_type: NodeType| {
        let parent = tree.parents[id as usize];
        let around = type_of(parent);
        match node_type {
            NodeType::ObjectExpression => is_options(id),
            NodeType::Property => is_options(parent),
            NodeType::Program
            | NodeType::ClassBody
            | NodeType::ImportDefaultSpecifier
            | NodeType::JSXText
            | NodeType::TSInterfaceBody
            | NodeType::TSEnumBody
            | NodeType::TSTypeAnnotation
            | NodeType::TSTypeParameterDeclaration
            | NodeType::TSTypeParameterInstantiation
            | NodeType::TSImportType
            | NodeType::TSEmptyBodyFunctionExpression => true,
            NodeType::FunctionExpression => match around {
                Some(NodeType::MethodDefinition | NodeType::TSAbstractMethodDefinition) => true,
                Some(NodeType::Property) => {
                    is_true(field(parent, Field::Method))
                        || !matches!(field(parent, Field::Kind), Value::Str(b"init"))
                }
                _ => false,
            },
            NodeType::Identifier => match around {
                Some(NodeType::MethodDefinition | NodeType::TSAbstractMethodDefinition) => {
                    matches!(field(parent, Field::Kind), Value::Str(b"constructor"))
                        && is_in(id, parent, Field::Key)
                }
                Some(NodeType::TSModuleDeclaration) => {
                    !matches!(field(parent, Field::Kind), Value::Str(b"global"))
                }
                Some(NodeType::Property) => {
                    is_options(tree.parents[parent as usize]) && is_in(id, parent, Field::Key)
                }
                Some(NodeType::TSQualifiedName) => {
                    let mut outer = parent;
                    while type_of(outer) == Some(NodeType::TSQualifiedName) {
                        outer = tree.parents[outer as usize];
                    }
                    type_of(outer) == Some(NodeType::TSModuleDeclaration)
                }
                _ => false,
            },
            NodeType::TSQualifiedName => {
                let mut outer = parent;
                while type_of(outer) == Some(NodeType::TSQualifiedName) {
                    outer = tree.parents[outer as usize];
                }
                type_of(outer) == Some(NodeType::TSModuleDeclaration)
            }
            // A parameter with a default, or a property of a pattern that declares. Not an element of an array.
            NodeType::AssignmentPattern => match around {
                Some(NodeType::Property) => is_binding(id),
                Some(NodeType::ArrayPattern | NodeType::AssignmentExpression) => false,
                Some(NodeType::ForInStatement | NodeType::ForOfStatement) => false,
                _ => true,
            },
            NodeType::JSXOpeningElement => is_true(field(id, Field::SelfClosing)),
            NodeType::ExportNamedDeclaration => {
                matches!(field(id, Field::Declaration), Value::Node(_))
            }
            NodeType::ExportDefaultDeclaration => matches!(
                type_of(id + 1),
                Some(
                    NodeType::FunctionDeclaration
                        | NodeType::TSDeclareFunction
                        | NodeType::ClassDeclaration
                        | NodeType::TSInterfaceDeclaration
                )
            ),
            NodeType::Literal => !matches!(field(id, Field::Bigint), Value::Undefined),
            NodeType::TSModuleDeclaration => type_of(id + 1) == Some(NodeType::Literal),
            _ => false,
        }
    };
    (0..tree.types.len() as u32)
        .filter(|&id| type_of(id).is_some_and(|it| is_alternate(id, it)))
        .collect()
}
