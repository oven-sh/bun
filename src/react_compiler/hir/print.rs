//! Shared formatting utilities for HIR debug printing.
//!
//! This module provides `PrintFormatter` — a stateful formatter that both
//! `react_compiler::debug_print` (HIR printer) and
//! `react_compiler_reactive_scopes::print_reactive_function` (reactive printer)
//! delegate to for shared formatting logic.
//!
//! It also exports standalone formatting functions (format_loc, format_primitive, etc.)
//! that require no state.

use core::fmt::{self, Write};
use std::collections::HashSet;

use bun_core::{BStr, ByteSlice};

use crate::diagnostics::CompilerError;
use crate::diagnostics::CompilerErrorOrDiagnostic;
use crate::diagnostics::SourceLocation;

use crate::hir::AliasingEffect;
use crate::hir::HirFunction;
use crate::hir::IdentifierId;
use crate::hir::IdentifierName;
use crate::hir::InstructionValue;
use crate::hir::LValue;
use crate::hir::MutationReason;
use crate::hir::Pattern;
use crate::hir::Place;
use crate::hir::PlaceOrSpreadOrHole;
use crate::hir::ScopeId;
use crate::hir::Type;
use crate::hir::environment::Environment;
use crate::hir::type_config::ValueKind;
use crate::hir::type_config::ValueReason;

// =============================================================================
// Standalone formatting functions (no state needed)
//
// These return lightweight `impl Display` adaptors so callers can embed them
// directly in `write!` / `format_args!` without allocating an intermediate
// `String`.
// =============================================================================

pub fn format_loc(loc: &Option<SourceLocation>) -> impl fmt::Display + '_ {
    DisplayLoc(loc)
}

pub fn format_loc_value(loc: &SourceLocation) -> impl fmt::Display + '_ {
    DisplayLocValue(loc)
}

/// Format a string like JS `JSON.stringify`: escape control chars and quotes
/// but preserve non-ASCII unicode (e.g. U+00A0 nbsp) as literal characters.
pub fn format_js_string(s: &[u8]) -> impl fmt::Display + '_ {
    DisplayJsString(s)
}

pub fn format_primitive(prim: &crate::hir::PrimitiveValue) -> impl fmt::Display + '_ {
    DisplayPrimitive(prim)
}

pub fn format_property_literal(prop: &crate::hir::PropertyLiteral) -> impl fmt::Display + '_ {
    DisplayPropertyLiteral(prop)
}

pub fn format_object_property_key(key: &crate::hir::ObjectPropertyKey) -> impl fmt::Display + '_ {
    DisplayObjectPropertyKey(key)
}

pub fn format_non_local_binding(binding: &crate::hir::NonLocalBinding) -> impl fmt::Display + '_ {
    DisplayNonLocalBinding(binding)
}

pub fn format_value_kind(kind: ValueKind) -> &'static str {
    match kind {
        ValueKind::Mutable => "mutable",
        ValueKind::Frozen => "frozen",
        ValueKind::Primitive => "primitive",
        ValueKind::MaybeFrozen => "maybe-frozen",
        ValueKind::Global => "global",
        ValueKind::Context => "context",
    }
}

pub fn format_value_reason(reason: ValueReason) -> &'static str {
    match reason {
        ValueReason::KnownReturnSignature => "known-return-signature",
        ValueReason::State => "state",
        ValueReason::ReducerState => "reducer-state",
        ValueReason::Context => "context",
        ValueReason::Effect => "effect",
        ValueReason::HookCaptured => "hook-captured",
        ValueReason::HookReturn => "hook-return",
        ValueReason::Global => "global",
        ValueReason::JsxCaptured => "jsx-captured",
        ValueReason::StoreLocal => "store-local",
        ValueReason::ReactiveFunctionArgument => "reactive-function-argument",
        ValueReason::Other => "other",
    }
}

// -----------------------------------------------------------------------------
// Display adaptors
// -----------------------------------------------------------------------------

struct DisplayLoc<'a>(&'a Option<SourceLocation>);
impl fmt::Display for DisplayLoc<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(l) => DisplayLocValue(l).fmt(f),
            None => f.write_str("generated"),
        }
    }
}

struct DisplayLocValue<'a>(&'a SourceLocation);
impl fmt::Display for DisplayLocValue<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let l = self.0;
        write!(
            f,
            "{}:{}-{}:{}",
            l.start.line, l.start.column, l.end.line, l.end.column
        )
    }
}

struct DisplayJsString<'a>(&'a [u8]);
impl fmt::Display for DisplayJsString<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write_js_escaped_chars(f, self.0.chars())
    }
}

fn write_js_escaped_chars(f: &mut impl Write, chars: impl Iterator<Item = char>) -> fmt::Result {
    f.write_char('"')?;
    for c in chars {
        match c {
            '"' => f.write_str("\\\"")?,
            '\\' => f.write_str("\\\\")?,
            '\n' => f.write_str("\\n")?,
            '\r' => f.write_str("\\r")?,
            '\t' => f.write_str("\\t")?,
            '\u{0008}' => f.write_str("\\b")?,
            '\u{000c}' => f.write_str("\\f")?,
            // Only escape C0 control chars (U+0000–U+001F), matching JS JSON.stringify.
            // Do NOT escape C1 controls (U+0080–U+009F) — JS outputs those as literal chars.
            c if (c as u32) <= 0x1F => write!(f, "\\u{:04x}", c as u32)?,
            c => f.write_char(c)?,
        }
    }
    f.write_char('"')
}

struct DisplayPrimitive<'a>(&'a crate::hir::PrimitiveValue);
impl fmt::Display for DisplayPrimitive<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            crate::hir::PrimitiveValue::Null => f.write_str("null"),
            crate::hir::PrimitiveValue::Undefined => f.write_str("undefined"),
            crate::hir::PrimitiveValue::Boolean(b) => write!(f, "{}", b),
            crate::hir::PrimitiveValue::Number(n) => {
                f.write_str(&crate::hir::format_js_number(n.value()))
            }
            crate::hir::PrimitiveValue::String(s) => {
                let e = s.estring();
                if !e.is_utf16 {
                    return write_js_escaped_chars(f, e.slice8().chars());
                }
                f.write_char('"')?;
                for r in char::decode_utf16(e.slice16().iter().copied()) {
                    match r {
                        Err(e) => write!(f, "\\u{:04x}", e.unpaired_surrogate())?,
                        Ok('"') => f.write_str("\\\"")?,
                        Ok('\\') => f.write_str("\\\\")?,
                        Ok('\n') => f.write_str("\\n")?,
                        Ok('\r') => f.write_str("\\r")?,
                        Ok('\t') => f.write_str("\\t")?,
                        Ok('\u{0008}') => f.write_str("\\b")?,
                        Ok('\u{000c}') => f.write_str("\\f")?,
                        Ok(c) if (c as u32) <= 0x1F => write!(f, "\\u{:04x}", c as u32)?,
                        Ok(c) => f.write_char(c)?,
                    }
                }
                f.write_char('"')
            }
        }
    }
}

struct DisplayPropertyLiteral<'a>(&'a crate::hir::PropertyLiteral);
impl fmt::Display for DisplayPropertyLiteral<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            crate::hir::PropertyLiteral::String(s) => fmt::Display::fmt(BStr::new(s.slice()), f),
            crate::hir::PropertyLiteral::Number(n) => {
                f.write_str(&crate::hir::format_js_number(n.value()))
            }
        }
    }
}

struct DisplayObjectPropertyKey<'a>(&'a crate::hir::ObjectPropertyKey);
impl fmt::Display for DisplayObjectPropertyKey<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            crate::hir::ObjectPropertyKey::String { name } => {
                write!(f, "String(\"{}\")", BStr::new(name.slice()))
            }
            crate::hir::ObjectPropertyKey::Identifier { name } => {
                write!(f, "Identifier(\"{}\")", BStr::new(name.slice()))
            }
            crate::hir::ObjectPropertyKey::Computed { name } => {
                write!(f, "Computed({})", name.identifier.0)
            }
            crate::hir::ObjectPropertyKey::Number { name } => {
                write!(f, "Number({})", crate::hir::format_js_number(name.value()))
            }
        }
    }
}

struct DisplayNonLocalBinding<'a>(&'a crate::hir::NonLocalBinding);
impl fmt::Display for DisplayNonLocalBinding<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0.kind {
            crate::hir::NonLocalKind::Global { name } => {
                write!(f, "Global {{ name: \"{}\" }}", BStr::new(name.slice()))
            }
            crate::hir::NonLocalKind::ModuleLocal { name } => {
                write!(f, "ModuleLocal {{ name: \"{}\" }}", BStr::new(name.slice()))
            }
            crate::hir::NonLocalKind::ImportDefault { name, module } => {
                write!(
                    f,
                    "ImportDefault {{ name: \"{}\", module: \"{}\" }}",
                    BStr::new(name.slice()),
                    BStr::new(module.slice())
                )
            }
            crate::hir::NonLocalKind::ImportNamespace { name, module } => {
                write!(
                    f,
                    "ImportNamespace {{ name: \"{}\", module: \"{}\" }}",
                    BStr::new(name.slice()),
                    BStr::new(module.slice())
                )
            }
            crate::hir::NonLocalKind::ImportSpecifier {
                name,
                module,
                imported,
            } => {
                write!(
                    f,
                    "ImportSpecifier {{ name: \"{}\", module: \"{}\", imported: \"{}\" }}",
                    BStr::new(name.slice()),
                    BStr::new(module.slice()),
                    BStr::new(imported.slice())
                )
            }
            crate::hir::NonLocalKind::BunOpaque(e) => {
                write!(f, "BunOpaque {{ tag: {:?} }}", e.data.tag())
            }
        }
    }
}

pub struct DisplayEffect<'a>(pub &'a AliasingEffect);
impl fmt::Display for DisplayEffect<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            AliasingEffect::Freeze { value, reason } => {
                write!(
                    f,
                    "Freeze {{ value: {}, reason: {} }}",
                    value.identifier.0,
                    format_value_reason(*reason)
                )
            }
            AliasingEffect::Mutate { value, reason } => match reason {
                Some(MutationReason::AssignCurrentProperty) => {
                    write!(
                        f,
                        "Mutate {{ value: {}, reason: AssignCurrentProperty }}",
                        value.identifier.0
                    )
                }
                None => write!(f, "Mutate {{ value: {} }}", value.identifier.0),
            },
            AliasingEffect::MutateConditionally { value } => {
                write!(f, "MutateConditionally {{ value: {} }}", value.identifier.0)
            }
            AliasingEffect::MutateTransitive { value } => {
                write!(f, "MutateTransitive {{ value: {} }}", value.identifier.0)
            }
            AliasingEffect::MutateTransitiveConditionally { value } => {
                write!(
                    f,
                    "MutateTransitiveConditionally {{ value: {} }}",
                    value.identifier.0
                )
            }
            AliasingEffect::Capture { from, into } => {
                write!(
                    f,
                    "Capture {{ into: {}, from: {} }}",
                    into.identifier.0, from.identifier.0
                )
            }
            AliasingEffect::Alias { from, into } => {
                write!(
                    f,
                    "Alias {{ into: {}, from: {} }}",
                    into.identifier.0, from.identifier.0
                )
            }
            AliasingEffect::MaybeAlias { from, into } => {
                write!(
                    f,
                    "MaybeAlias {{ into: {}, from: {} }}",
                    into.identifier.0, from.identifier.0
                )
            }
            AliasingEffect::Assign { from, into } => {
                write!(
                    f,
                    "Assign {{ into: {}, from: {} }}",
                    into.identifier.0, from.identifier.0
                )
            }
            AliasingEffect::Create {
                into,
                value,
                reason,
            } => {
                write!(
                    f,
                    "Create {{ into: {}, value: {}, reason: {} }}",
                    into.identifier.0,
                    format_value_kind(*value),
                    format_value_reason(*reason)
                )
            }
            AliasingEffect::CreateFrom { from, into } => {
                write!(
                    f,
                    "CreateFrom {{ into: {}, from: {} }}",
                    into.identifier.0, from.identifier.0
                )
            }
            AliasingEffect::ImmutableCapture { from, into } => {
                write!(
                    f,
                    "ImmutableCapture {{ into: {}, from: {} }}",
                    into.identifier.0, from.identifier.0
                )
            }
            AliasingEffect::Apply {
                receiver,
                function,
                mutates_function,
                args,
                into,
                ..
            } => {
                write!(
                    f,
                    "Apply {{ into: {}, receiver: {}, function: {}, mutatesFunction: {}, args: [",
                    into.identifier.0,
                    receiver.identifier.0,
                    function.identifier.0,
                    mutates_function,
                )?;
                for (i, a) in args.iter().enumerate() {
                    if i > 0 {
                        f.write_str(", ")?;
                    }
                    match a {
                        PlaceOrSpreadOrHole::Hole => f.write_str("hole")?,
                        PlaceOrSpreadOrHole::Place(p) => write!(f, "{}", p.identifier.0)?,
                        PlaceOrSpreadOrHole::Spread(s) => write!(f, "...{}", s.place.identifier.0)?,
                    }
                }
                f.write_str("] }")
            }
            AliasingEffect::CreateFunction {
                captures,
                function_id: _,
                into,
            } => {
                write!(
                    f,
                    "CreateFunction {{ into: {}, captures: [",
                    into.identifier.0
                )?;
                for (i, p) in captures.iter().enumerate() {
                    if i > 0 {
                        f.write_str(", ")?;
                    }
                    write!(f, "{}", p.identifier.0)?;
                }
                f.write_str("] }")
            }
            AliasingEffect::MutateFrozen { place, error } => {
                write!(
                    f,
                    "MutateFrozen {{ place: {}, reason: {:?} }}",
                    place.identifier.0, error.reason
                )
            }
            AliasingEffect::MutateGlobal { place, error } => {
                write!(
                    f,
                    "MutateGlobal {{ place: {}, reason: {:?} }}",
                    place.identifier.0, error.reason
                )
            }
            AliasingEffect::Impure { place, error } => {
                write!(
                    f,
                    "Impure {{ place: {}, reason: {:?} }}",
                    place.identifier.0, error.reason
                )
            }
            AliasingEffect::Render { place } => {
                write!(f, "Render {{ place: {} }}", place.identifier.0)
            }
        }
    }
}

pub struct DisplayType<'a>(pub &'a Type);
impl fmt::Display for DisplayType<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Type::Primitive => f.write_str("Primitive"),
            Type::Function {
                shape_id,
                return_type,
                is_constructor,
            } => {
                f.write_str("Function { shapeId: ")?;
                match shape_id {
                    Some(s) => write!(f, "\"{}\"", s)?,
                    None => f.write_str("null")?,
                }
                write!(
                    f,
                    ", return: {}, isConstructor: {} }}",
                    DisplayType(&**return_type),
                    is_constructor
                )
            }
            Type::Object { shape_id } => {
                f.write_str("Object { shapeId: ")?;
                match shape_id {
                    Some(s) => write!(f, "\"{}\"", s)?,
                    None => f.write_str("null")?,
                }
                f.write_str(" }")
            }
            Type::TypeVar { id } => write!(f, "Type({})", id.0),
            Type::Poly => f.write_str("Poly"),
            Type::Phi { operands } => {
                f.write_str("Phi { operands: [")?;
                for (i, op) in operands.iter().enumerate() {
                    if i > 0 {
                        f.write_str(", ")?;
                    }
                    DisplayType(op).fmt(f)?;
                }
                f.write_str("] }")
            }
            Type::Property {
                object_type,
                object_name,
                property_name,
            } => {
                write!(
                    f,
                    "Property {{ objectType: {}, objectName: \"{}\", propertyName: ",
                    DisplayType(&**object_type),
                    BStr::new(object_name.slice()),
                )?;
                match property_name {
                    crate::hir::PropertyNameKind::Literal { value } => {
                        write!(f, "\"{}\"", DisplayPropertyLiteral(value))?;
                    }
                    crate::hir::PropertyNameKind::Computed { value } => {
                        write!(f, "computed({})", DisplayType(&**value))?;
                    }
                }
                f.write_str(" }")
            }
            Type::ObjectMethod => f.write_str("ObjectMethod"),
        }
    }
}

struct DisplayTypeId<'a> {
    env: &'a Environment,
    id: crate::hir::TypeId,
}
impl fmt::Display for DisplayTypeId<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.env.types.get(self.id.0 as usize) {
            Some(ty) => DisplayType(ty).fmt(f),
            None => write!(f, "Type({})", self.id.0),
        }
    }
}

// =============================================================================
// PrintFormatter — shared stateful formatter
// =============================================================================

/// Shared formatter state used by both HIR and reactive printers.
///
/// Both `DebugPrinter` structs delegate to this for formatting shared constructs
/// like Places, Identifiers, Scopes, Types, InstructionValues, etc.
pub struct PrintFormatter<'a> {
    pub env: &'a Environment,
    pub seen_identifiers: HashSet<IdentifierId>,
    pub seen_scopes: HashSet<ScopeId>,
    pub output: String,
    pub indent_level: usize,
}

impl<'a> PrintFormatter<'a> {
    pub fn new(env: &'a Environment) -> Self {
        Self {
            env,
            seen_identifiers: HashSet::new(),
            seen_scopes: HashSet::new(),
            output: String::new(),
            indent_level: 0,
        }
    }

    #[inline]
    fn begin_line(&mut self) {
        if !self.output.is_empty() {
            self.output.push('\n');
        }
        for _ in 0..self.indent_level {
            self.output.push_str("  ");
        }
    }

    pub fn line(&mut self, text: &str) {
        self.begin_line();
        self.output.push_str(text);
    }

    pub fn line_fmt(&mut self, args: fmt::Arguments<'_>) {
        self.begin_line();
        let _ = self.output.write_fmt(args);
    }

    /// Write a line without adding indentation (used when copying pre-formatted output)
    pub fn line_raw(&mut self, text: &str) {
        if !self.output.is_empty() {
            self.output.push('\n');
        }
        self.output.push_str(text);
    }

    pub fn indent(&mut self) {
        self.indent_level += 1;
    }

    pub fn dedent(&mut self) {
        self.indent_level -= 1;
    }

    pub fn to_string_output(&self) -> String {
        self.output.clone()
    }

    pub fn into_output(self) -> String {
        self.output
    }

    pub fn as_output(&self) -> &str {
        &self.output
    }

    // =========================================================================
    // AliasingEffect
    // =========================================================================

    pub fn format_effect<'e>(&self, effect: &'e AliasingEffect) -> impl fmt::Display + 'e {
        DisplayEffect(effect)
    }

    // =========================================================================
    // Place (with identifier deduplication)
    // =========================================================================

    pub fn format_place_field(&mut self, field_name: &str, place: &Place) {
        self.format_place_field_inner(format_args!("{}", field_name), place);
    }

    pub fn format_place_field_idx(&mut self, index: usize, place: &Place) {
        self.format_place_field_inner(format_args!("[{}]", index), place);
    }

    fn format_place_field_inner(&mut self, field_name: fmt::Arguments<'_>, place: &Place) {
        let is_seen = self.seen_identifiers.contains(&place.identifier);
        if is_seen {
            self.line_fmt(format_args!(
                "{}: Place {{ identifier: Identifier({}), effect: {}, reactive: {}, loc: {} }}",
                field_name,
                place.identifier.0,
                place.effect,
                place.reactive,
                format_loc(&place.loc)
            ));
        } else {
            self.line_fmt(format_args!("{}: Place {{", field_name));
            self.indent();
            self.line("identifier:");
            self.indent();
            self.format_identifier(place.identifier);
            self.dedent();
            self.line_fmt(format_args!("effect: {}", place.effect));
            self.line_fmt(format_args!("reactive: {}", place.reactive));
            self.line_fmt(format_args!("loc: {}", format_loc(&place.loc)));
            self.dedent();
            self.line("}");
        }
    }

    // =========================================================================
    // Identifier (first-seen expansion)
    // =========================================================================

    pub fn format_identifier(&mut self, id: IdentifierId) {
        self.seen_identifiers.insert(id);
        let env = self.env;
        let ident = &env.identifiers[id.0 as usize];
        self.line("Identifier {");
        self.indent();
        self.line_fmt(format_args!("id: {}", ident.id.0));
        self.line_fmt(format_args!("declarationId: {}", ident.declaration_id.0));
        match &ident.name {
            Some(name) => {
                let (kind, value) = match name {
                    IdentifierName::Named(n) => ("named", n.slice()),
                    IdentifierName::Promoted(n) => ("promoted", n.slice()),
                };
                self.line_fmt(format_args!(
                    "name: {{ kind: \"{}\", value: \"{}\" }}",
                    kind,
                    BStr::new(value)
                ));
            }
            None => self.line("name: null"),
        }
        // Print the identifier's mutable_range directly, matching the TS
        // DebugPrintHIR which prints `identifier.mutableRange`. In TS,
        // InferReactiveScopeVariables sets identifier.mutableRange = scope.range
        // (shared reference), and AlignReactiveScopesToBlockScopesHIR syncs them.
        // After MergeOverlappingReactiveScopesHIR repoints scopes, the TS
        // identifier.mutableRange still references the OLD scope's range (stale),
        // so we match by using ident.mutable_range directly (which is synced
        // at the AlignReactiveScopesToBlockScopesHIR step but not re-synced
        // after scope repointing in merge passes).
        self.line_fmt(format_args!(
            "mutableRange: [{}:{}]",
            ident.mutable_range.start.0, ident.mutable_range.end.0
        ));
        match ident.scope {
            Some(scope_id) => self.format_scope_field("scope", scope_id),
            None => self.line("scope: null"),
        }
        self.line_fmt(format_args!(
            "type: {}",
            DisplayTypeId {
                env,
                id: ident.type_
            }
        ));
        self.line_fmt(format_args!("loc: {}", format_loc(&ident.loc)));
        self.dedent();
        self.line("}");
    }

    // =========================================================================
    // Scope (with deduplication)
    // =========================================================================

    pub fn format_scope_field(&mut self, field_name: &str, scope_id: ScopeId) {
        let is_seen = self.seen_scopes.contains(&scope_id);
        if is_seen {
            self.line_fmt(format_args!("{}: Scope({})", field_name, scope_id.0));
        } else {
            self.seen_scopes.insert(scope_id);
            let env = self.env;
            if let Some(scope) = env.scopes.iter().find(|s| s.id == scope_id) {
                self.line_fmt(format_args!("{}: Scope {{", field_name));
                self.indent();
                self.line_fmt(format_args!("id: {}", scope_id.0));
                self.line_fmt(format_args!(
                    "range: [{}:{}]",
                    scope.range.start.0, scope.range.end.0
                ));

                // dependencies
                self.line("dependencies:");
                self.indent();
                for (i, dep) in scope.dependencies.iter().enumerate() {
                    self.begin_line();
                    let _ = write!(
                        self.output,
                        "[{}] {{ identifier: {}, reactive: {}, path: \"",
                        i, dep.identifier.0, dep.reactive
                    );
                    for p in dep.path.iter() {
                        let _ = write!(
                            self.output,
                            "{}{}",
                            if p.optional { "?." } else { "." },
                            DisplayPropertyLiteral(&p.property)
                        );
                    }
                    self.output.push_str("\" }");
                }
                self.dedent();

                // declarations
                self.line("declarations:");
                self.indent();
                for (ident_id, decl) in &scope.declarations {
                    self.line_fmt(format_args!(
                        "{}: {{ identifier: {}, scope: {} }}",
                        ident_id.0, decl.identifier.0, decl.scope.0
                    ));
                }
                self.dedent();

                // reassignments
                self.line("reassignments:");
                self.indent();
                for ident_id in &scope.reassignments {
                    self.line_fmt(format_args!("{}", ident_id.0));
                }
                self.dedent();

                // earlyReturnValue
                if let Some(early_return) = &scope.early_return_value {
                    self.line("earlyReturnValue:");
                    self.indent();
                    self.line_fmt(format_args!("value: {}", early_return.value.0));
                    self.line_fmt(format_args!("loc: {}", format_loc(&early_return.loc)));
                    self.line_fmt(format_args!("label: bb{}", early_return.label.0));
                    self.dedent();
                } else {
                    self.line("earlyReturnValue: null");
                }

                // merged
                self.begin_line();
                self.output.push_str("merged: [");
                for (i, s) in scope.merged.iter().enumerate() {
                    if i > 0 {
                        self.output.push_str(", ");
                    }
                    let _ = write!(self.output, "{}", s.0);
                }
                self.output.push(']');

                // loc
                self.line_fmt(format_args!("loc: {}", format_loc(&scope.loc)));

                self.dedent();
                self.line("}");
            } else {
                self.line_fmt(format_args!("{}: Scope({})", field_name, scope_id.0));
            }
        }
    }

    // =========================================================================
    // Type
    // =========================================================================

    pub fn format_type(&self, type_id: crate::hir::TypeId) -> impl fmt::Display + 'a {
        DisplayTypeId {
            env: self.env,
            id: type_id,
        }
    }

    pub fn format_type_value<'t>(&self, ty: &'t Type) -> impl fmt::Display + 't {
        DisplayType(ty)
    }

    // =========================================================================
    // LValue
    // =========================================================================

    pub fn format_lvalue(&mut self, field_name: &str, lv: &LValue) {
        self.line_fmt(format_args!("{}:", field_name));
        self.indent();
        self.line_fmt(format_args!("kind: {:?}", lv.kind));
        self.format_place_field("place", &lv.place);
        self.dedent();
    }

    // =========================================================================
    // Pattern
    // =========================================================================

    pub fn format_pattern(&mut self, pattern: &Pattern) {
        match pattern {
            Pattern::Array(arr) => {
                self.line("pattern: ArrayPattern {");
                self.indent();
                self.line("items:");
                self.indent();
                for (i, item) in arr.items.iter().enumerate() {
                    match item {
                        crate::hir::ArrayPatternElement::Hole => {
                            self.line_fmt(format_args!("[{}] Hole", i));
                        }
                        crate::hir::ArrayPatternElement::Place(p) => {
                            self.format_place_field_idx(i, p);
                        }
                        crate::hir::ArrayPatternElement::Spread(s) => {
                            self.line_fmt(format_args!("[{}] Spread:", i));
                            self.indent();
                            self.format_place_field("place", &s.place);
                            self.dedent();
                        }
                    }
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(&arr.loc)));
                self.dedent();
                self.line("}");
            }
            Pattern::Object(obj) => {
                self.line("pattern: ObjectPattern {");
                self.indent();
                self.line("properties:");
                self.indent();
                for (i, prop) in obj.properties.iter().enumerate() {
                    match prop {
                        crate::hir::ObjectPropertyOrSpread::Property(p) => {
                            self.line_fmt(format_args!("[{}] ObjectProperty {{", i));
                            self.indent();
                            self.line_fmt(format_args!(
                                "key: {}",
                                format_object_property_key(&p.key)
                            ));
                            self.line_fmt(format_args!("type: \"{}\"", p.property_type));
                            self.format_place_field("place", &p.place);
                            self.dedent();
                            self.line("}");
                        }
                        crate::hir::ObjectPropertyOrSpread::Spread(s) => {
                            self.line_fmt(format_args!("[{}] Spread:", i));
                            self.indent();
                            self.format_place_field("place", &s.place);
                            self.dedent();
                        }
                    }
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(&obj.loc)));
                self.dedent();
                self.line("}");
            }
        }
    }

    // =========================================================================
    // Arguments
    // =========================================================================

    pub fn format_argument(&mut self, arg: &crate::hir::PlaceOrSpread, index: usize) {
        match arg {
            crate::hir::PlaceOrSpread::Place(p) => {
                self.format_place_field_idx(index, p);
            }
            crate::hir::PlaceOrSpread::Spread(s) => {
                self.line_fmt(format_args!("[{}] Spread:", index));
                self.indent();
                self.format_place_field("place", &s.place);
                self.dedent();
            }
        }
    }

    // =========================================================================
    // InstructionValue
    // =========================================================================

    /// Format an InstructionValue. The `inner_func_formatter` callback is invoked
    /// for FunctionExpression/ObjectMethod to format the inner HirFunction. If None,
    /// a placeholder is printed instead.
    pub fn format_instruction_value(
        &mut self,
        value: &InstructionValue,
        inner_func_formatter: Option<&dyn Fn(&mut PrintFormatter, &HirFunction)>,
    ) {
        match value {
            InstructionValue::ArrayExpression { elements, loc } => {
                self.line("ArrayExpression {");
                self.indent();
                self.line("elements:");
                self.indent();
                for (i, elem) in elements.iter().enumerate() {
                    match elem {
                        crate::hir::ArrayElement::Place(p) => {
                            self.format_place_field_idx(i, p);
                        }
                        crate::hir::ArrayElement::Hole => {
                            self.line_fmt(format_args!("[{}] Hole", i));
                        }
                        crate::hir::ArrayElement::Spread(s) => {
                            self.line_fmt(format_args!("[{}] Spread:", i));
                            self.indent();
                            self.format_place_field("place", &s.place);
                            self.dedent();
                        }
                    }
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::ObjectExpression { properties, loc } => {
                self.line("ObjectExpression {");
                self.indent();
                self.line("properties:");
                self.indent();
                for (i, prop) in properties.iter().enumerate() {
                    match prop {
                        crate::hir::ObjectPropertyOrSpread::Property(p) => {
                            self.line_fmt(format_args!("[{}] ObjectProperty {{", i));
                            self.indent();
                            self.line_fmt(format_args!(
                                "key: {}",
                                format_object_property_key(&p.key)
                            ));
                            self.line_fmt(format_args!("type: \"{}\"", p.property_type));
                            self.format_place_field("place", &p.place);
                            self.dedent();
                            self.line("}");
                        }
                        crate::hir::ObjectPropertyOrSpread::Spread(s) => {
                            self.line_fmt(format_args!("[{}] Spread:", i));
                            self.indent();
                            self.format_place_field("place", &s.place);
                            self.dedent();
                        }
                    }
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::UnaryExpression {
                operator,
                value: val,
                loc,
            } => {
                self.line("UnaryExpression {");
                self.indent();
                self.line_fmt(format_args!("operator: \"{}\"", operator));
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::BinaryExpression {
                operator,
                left,
                right,
                loc,
            } => {
                self.line("BinaryExpression {");
                self.indent();
                self.line_fmt(format_args!("operator: \"{}\"", operator));
                self.format_place_field("left", left);
                self.format_place_field("right", right);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::NewExpression { callee, args, loc } => {
                self.line("NewExpression {");
                self.indent();
                self.format_place_field("callee", callee);
                self.line("args:");
                self.indent();
                for (i, arg) in args.iter().enumerate() {
                    self.format_argument(arg, i);
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::CallExpression { callee, args, loc } => {
                self.line("CallExpression {");
                self.indent();
                self.format_place_field("callee", callee);
                self.line("args:");
                self.indent();
                for (i, arg) in args.iter().enumerate() {
                    self.format_argument(arg, i);
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::MethodCall {
                receiver,
                property,
                args,
                loc,
            } => {
                self.line("MethodCall {");
                self.indent();
                self.format_place_field("receiver", receiver);
                self.format_place_field("property", property);
                self.line("args:");
                self.indent();
                for (i, arg) in args.iter().enumerate() {
                    self.format_argument(arg, i);
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::JSXText { value: val, loc } => {
                self.line_fmt(format_args!(
                    "JSXText {{ value: {}, loc: {} }}",
                    format_js_string(val.slice()),
                    format_loc(loc)
                ));
            }
            InstructionValue::Primitive { value: prim, loc } => {
                self.line_fmt(format_args!(
                    "Primitive {{ value: {}, loc: {} }}",
                    format_primitive(prim),
                    format_loc(loc)
                ));
            }
            InstructionValue::TypeCastExpression {
                value: val,
                type_,
                type_annotation_name,
                type_annotation_kind,
                type_annotation: _,
                loc,
            } => {
                self.line("TypeCastExpression {");
                self.indent();
                self.format_place_field("value", val);
                self.line_fmt(format_args!("type: {}", DisplayType(type_)));
                if let Some(annotation_name) = type_annotation_name {
                    self.line_fmt(format_args!(
                        "typeAnnotation: {}",
                        BStr::new(annotation_name.slice())
                    ));
                }
                if let Some(annotation_kind) = type_annotation_kind {
                    self.line_fmt(format_args!("typeAnnotationKind: \"{}\"", annotation_kind));
                }
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::JsxExpression {
                tag,
                props,
                children,
                loc,
                opening_loc,
                closing_loc,
            } => {
                self.line("JsxExpression {");
                self.indent();
                match tag {
                    crate::hir::JsxTag::Place(p) => {
                        self.format_place_field("tag", p);
                    }
                    crate::hir::JsxTag::Builtin(b) => {
                        self.line_fmt(format_args!(
                            "tag: BuiltinTag(\"{}\")",
                            BStr::new(b.name.slice())
                        ));
                    }
                }
                self.line("props:");
                self.indent();
                for (i, prop) in props.iter().enumerate() {
                    match prop {
                        crate::hir::JsxAttribute::Attribute { name, place } => {
                            self.line_fmt(format_args!("[{}] JsxAttribute {{", i));
                            self.indent();
                            self.line_fmt(format_args!("name: \"{}\"", BStr::new(name.slice())));
                            self.format_place_field("place", place);
                            self.dedent();
                            self.line("}");
                        }
                        crate::hir::JsxAttribute::SpreadAttribute { argument } => {
                            self.line_fmt(format_args!("[{}] JsxSpreadAttribute:", i));
                            self.indent();
                            self.format_place_field("argument", argument);
                            self.dedent();
                        }
                    }
                }
                self.dedent();
                match children {
                    Some(c) => {
                        self.line("children:");
                        self.indent();
                        for (i, child) in c.iter().enumerate() {
                            self.format_place_field_idx(i, child);
                        }
                        self.dedent();
                    }
                    None => self.line("children: null"),
                }
                self.line_fmt(format_args!("openingLoc: {}", format_loc(opening_loc)));
                self.line_fmt(format_args!("closingLoc: {}", format_loc(closing_loc)));
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::JsxFragment { children, loc } => {
                self.line("JsxFragment {");
                self.indent();
                self.line("children:");
                self.indent();
                for (i, child) in children.iter().enumerate() {
                    self.format_place_field_idx(i, child);
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::UnsupportedNode { node_type, loc, .. } => match node_type {
                Some(t) => self.line_fmt(format_args!(
                    "UnsupportedNode {{ type: {:?}, loc: {} }}",
                    t,
                    format_loc(loc)
                )),
                None => self.line_fmt(format_args!(
                    "UnsupportedNode {{ loc: {} }}",
                    format_loc(loc)
                )),
            },
            InstructionValue::LoadLocal { place, loc } => {
                self.line("LoadLocal {");
                self.indent();
                self.format_place_field("place", place);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::DeclareLocal {
                lvalue,
                type_annotation,
                loc,
            } => {
                self.line("DeclareLocal {");
                self.indent();
                self.format_lvalue("lvalue", lvalue);
                match type_annotation {
                    Some(t) => self.line_fmt(format_args!("type: {}", BStr::new(t.slice()))),
                    None => self.line("type: null"),
                }
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::DeclareContext { lvalue, loc } => {
                self.line("DeclareContext {");
                self.indent();
                self.line("lvalue:");
                self.indent();
                self.line_fmt(format_args!("kind: {:?}", lvalue.kind));
                self.format_place_field("place", &lvalue.place);
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::StoreLocal {
                lvalue,
                value: val,
                type_annotation,
                loc,
            } => {
                self.line("StoreLocal {");
                self.indent();
                self.format_lvalue("lvalue", lvalue);
                self.format_place_field("value", val);
                match type_annotation {
                    Some(t) => self.line_fmt(format_args!("type: {}", BStr::new(t.slice()))),
                    None => self.line("type: null"),
                }
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::LoadContext { place, loc } => {
                self.line("LoadContext {");
                self.indent();
                self.format_place_field("place", place);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::StoreContext {
                lvalue,
                value: val,
                loc,
            } => {
                self.line("StoreContext {");
                self.indent();
                self.line("lvalue:");
                self.indent();
                self.line_fmt(format_args!("kind: {:?}", lvalue.kind));
                self.format_place_field("place", &lvalue.place);
                self.dedent();
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::Destructure {
                lvalue,
                value: val,
                loc,
            } => {
                self.line("Destructure {");
                self.indent();
                self.line("lvalue:");
                self.indent();
                self.line_fmt(format_args!("kind: {:?}", lvalue.kind));
                self.format_pattern(&lvalue.pattern);
                self.dedent();
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::PropertyLoad {
                object,
                property,
                loc,
            } => {
                self.line("PropertyLoad {");
                self.indent();
                self.format_place_field("object", object);
                self.line_fmt(format_args!(
                    "property: \"{}\"",
                    format_property_literal(property)
                ));
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::PropertyStore {
                object,
                property,
                value: val,
                loc,
            } => {
                self.line("PropertyStore {");
                self.indent();
                self.format_place_field("object", object);
                self.line_fmt(format_args!(
                    "property: \"{}\"",
                    format_property_literal(property)
                ));
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::PropertyDelete {
                object,
                property,
                loc,
            } => {
                self.line("PropertyDelete {");
                self.indent();
                self.format_place_field("object", object);
                self.line_fmt(format_args!(
                    "property: \"{}\"",
                    format_property_literal(property)
                ));
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::ComputedLoad {
                object,
                property,
                loc,
            } => {
                self.line("ComputedLoad {");
                self.indent();
                self.format_place_field("object", object);
                self.format_place_field("property", property);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::ComputedStore {
                object,
                property,
                value: val,
                loc,
            } => {
                self.line("ComputedStore {");
                self.indent();
                self.format_place_field("object", object);
                self.format_place_field("property", property);
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::ComputedDelete {
                object,
                property,
                loc,
            } => {
                self.line("ComputedDelete {");
                self.indent();
                self.format_place_field("object", object);
                self.format_place_field("property", property);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::LoadGlobal { binding, loc } => {
                self.line("LoadGlobal {");
                self.indent();
                self.line_fmt(format_args!(
                    "binding: {}",
                    format_non_local_binding(binding)
                ));
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::StoreGlobal {
                name,
                value: val,
                loc,
                ..
            } => {
                self.line("StoreGlobal {");
                self.indent();
                self.line_fmt(format_args!("name: \"{}\"", BStr::new(name.slice())));
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::FunctionExpression {
                name,
                name_hint,
                lowered_func,
                expr_type,
                loc,
            } => {
                self.line("FunctionExpression {");
                self.indent();
                match name {
                    Some(n) => self.line_fmt(format_args!("name: \"{}\"", BStr::new(n.slice()))),
                    None => self.line("name: null"),
                }
                match name_hint {
                    Some(h) => {
                        self.line_fmt(format_args!("nameHint: \"{}\"", BStr::new(h.slice())))
                    }
                    None => self.line("nameHint: null"),
                }
                self.line_fmt(format_args!("type: \"{:?}\"", expr_type));
                self.line("loweredFunc:");
                let env = self.env;
                let inner_func = &env.functions[lowered_func.func.0 as usize];
                if let Some(formatter) = inner_func_formatter {
                    formatter(self, inner_func);
                } else {
                    self.line_fmt(format_args!("  <function {}>", lowered_func.func.0));
                }
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::ObjectMethod { loc, lowered_func } => {
                self.line("ObjectMethod {");
                self.indent();
                self.line("loweredFunc:");
                let env = self.env;
                let inner_func = &env.functions[lowered_func.func.0 as usize];
                if let Some(formatter) = inner_func_formatter {
                    formatter(self, inner_func);
                } else {
                    self.line_fmt(format_args!("  <function {}>", lowered_func.func.0));
                }
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::TaggedTemplateExpression {
                tag,
                value: val,
                loc,
            } => {
                self.line("TaggedTemplateExpression {");
                self.indent();
                self.format_place_field("tag", tag);
                self.line_fmt(format_args!("raw: {}", format_js_string(val.raw.slice())));
                match &val.cooked {
                    Some(c) => {
                        self.line_fmt(format_args!("cooked: {}", format_js_string(c.slice())))
                    }
                    None => self.line("cooked: undefined"),
                }
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::TemplateLiteral {
                subexprs,
                quasis,
                loc,
            } => {
                self.line("TemplateLiteral {");
                self.indent();
                self.line("subexprs:");
                self.indent();
                for (i, sub) in subexprs.iter().enumerate() {
                    self.format_place_field_idx(i, sub);
                }
                self.dedent();
                self.line("quasis:");
                self.indent();
                for (i, q) in quasis.iter().enumerate() {
                    self.begin_line();
                    let _ = write!(
                        self.output,
                        "[{}] {{ raw: {}, cooked: ",
                        i,
                        format_js_string(q.raw.slice())
                    );
                    match &q.cooked {
                        Some(c) => {
                            let _ = write!(self.output, "{}", format_js_string(c.slice()));
                        }
                        None => self.output.push_str("undefined"),
                    }
                    self.output.push_str(" }");
                }
                self.dedent();
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::RegExpLiteral {
                pattern,
                flags,
                loc,
            } => {
                self.line_fmt(format_args!(
                    "RegExpLiteral {{ pattern: \"{}\", flags: \"{}\", loc: {} }}",
                    BStr::new(pattern.slice()),
                    BStr::new(flags.slice()),
                    format_loc(loc)
                ));
            }
            InstructionValue::MetaProperty {
                meta,
                property,
                loc,
            } => {
                self.line_fmt(format_args!(
                    "MetaProperty {{ meta: \"{}\", property: \"{}\", loc: {} }}",
                    meta,
                    property,
                    format_loc(loc)
                ));
            }
            InstructionValue::Await { value: val, loc } => {
                self.line("Await {");
                self.indent();
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::GetIterator { collection, loc } => {
                self.line("GetIterator {");
                self.indent();
                self.format_place_field("collection", collection);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::IteratorNext {
                iterator,
                collection,
                loc,
            } => {
                self.line("IteratorNext {");
                self.indent();
                self.format_place_field("iterator", iterator);
                self.format_place_field("collection", collection);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::NextPropertyOf { value: val, loc } => {
                self.line("NextPropertyOf {");
                self.indent();
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::Debugger { loc } => {
                self.line_fmt(format_args!("Debugger {{ loc: {} }}", format_loc(loc)));
            }
            InstructionValue::PostfixUpdate {
                lvalue,
                operation,
                value: val,
                loc,
            } => {
                self.line("PostfixUpdate {");
                self.indent();
                self.format_place_field("lvalue", lvalue);
                self.line_fmt(format_args!("operation: \"{}\"", operation));
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::PrefixUpdate {
                lvalue,
                operation,
                value: val,
                loc,
            } => {
                self.line("PrefixUpdate {");
                self.indent();
                self.format_place_field("lvalue", lvalue);
                self.line_fmt(format_args!("operation: \"{}\"", operation));
                self.format_place_field("value", val);
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::StartMemoize {
                manual_memo_id,
                deps,
                deps_loc: _,
                has_invalid_deps: _,
                loc,
            } => {
                self.line("StartMemoize {");
                self.indent();
                self.line_fmt(format_args!("manualMemoId: {}", manual_memo_id));
                match deps {
                    Some(d) => {
                        self.line("deps:");
                        self.indent();
                        for (i, dep) in d.iter().enumerate() {
                            self.begin_line();
                            let _ = write!(self.output, "[{}] ", i);
                            match &dep.root {
                                crate::hir::ManualMemoDependencyRoot::Global {
                                    identifier_name,
                                } => {
                                    let _ = write!(
                                        self.output,
                                        "Global(\"{}\")",
                                        BStr::new(identifier_name.slice())
                                    );
                                }
                                crate::hir::ManualMemoDependencyRoot::NamedLocal {
                                    value: val,
                                    constant,
                                } => {
                                    let _ = write!(
                                        self.output,
                                        "NamedLocal({}, constant={})",
                                        val.identifier.0, constant
                                    );
                                }
                            }
                            for p in dep.path.iter() {
                                let _ = write!(
                                    self.output,
                                    "{}.{}",
                                    if p.optional { "?" } else { "" },
                                    DisplayPropertyLiteral(&p.property)
                                );
                            }
                        }
                        self.dedent();
                    }
                    None => self.line("deps: null"),
                }
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
            InstructionValue::FinishMemoize {
                manual_memo_id,
                decl,
                pruned,
                loc,
            } => {
                self.line("FinishMemoize {");
                self.indent();
                self.line_fmt(format_args!("manualMemoId: {}", manual_memo_id));
                self.format_place_field("decl", decl);
                self.line_fmt(format_args!("pruned: {}", pruned));
                self.line_fmt(format_args!("loc: {}", format_loc(loc)));
                self.dedent();
                self.line("}");
            }
        }
    }

    // =========================================================================
    // Errors
    // =========================================================================

    pub fn format_errors(&mut self, error: &CompilerError) {
        if error.details.is_empty() {
            self.line("Errors: []");
            return;
        }
        self.line("Errors:");
        self.indent();
        for (i, detail) in error.details.iter().enumerate() {
            self.line_fmt(format_args!("[{}] {{", i));
            self.indent();
            match detail {
                CompilerErrorOrDiagnostic::Diagnostic(d) => {
                    self.line_fmt(format_args!("severity: {:?}", d.severity()));
                    self.line_fmt(format_args!("reason: {:?}", d.reason));
                    match &d.description {
                        Some(desc) => self.line_fmt(format_args!("description: {:?}", desc)),
                        None => self.line("description: null"),
                    }
                    self.line_fmt(format_args!("category: {:?}", d.category));
                    match d.primary_location() {
                        Some(l) => self.line_fmt(format_args!("loc: {}", format_loc_value(l))),
                        None => self.line("loc: null"),
                    }
                }
                CompilerErrorOrDiagnostic::ErrorDetail(d) => {
                    self.line_fmt(format_args!("severity: {:?}", d.severity()));
                    self.line_fmt(format_args!("reason: {:?}", d.reason));
                    match &d.description {
                        Some(desc) => self.line_fmt(format_args!("description: {:?}", desc)),
                        None => self.line("description: null"),
                    }
                    self.line_fmt(format_args!("category: {:?}", d.category));
                    match &d.loc {
                        Some(l) => self.line_fmt(format_args!("loc: {}", format_loc_value(l))),
                        None => self.line("loc: null"),
                    }
                }
            }
            self.dedent();
            self.line("}");
        }
        self.dedent();
    }
}
