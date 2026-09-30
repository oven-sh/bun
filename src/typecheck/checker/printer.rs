// checker/printer.go: how types, symbols, signatures and type predicates become text.
use crate::ast::{Ast, Kind, NodeId, SymbolFlags, SymbolId, get_source_file_of_node};
use crate::checker::nodebuilder::VerbosityContext;
use crate::checker::nodebuilderimpl::{
    DEFAULT_MAXIMUM_TRUNCATION_LENGTH, NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH,
};
use crate::checker::{
    Checker, LiteralValue, MAX_SERIALIZATION_LEVEL, SignatureFlags, SignatureId, SymbolFormatFlags,
    TypeFlags, TypeFormatFlags, TypeId, TypePredicateId, value_to_string,
};
use crate::nodebuilder::{Flags, InternalFlags};
use crate::printer::{
    EmitContext, PrintHandlers, Printer, PrinterOptions, get_single_line_string_writer,
    new_printer, new_text_writer,
};

fn create_printer_with_defaults<'p>(a: Ast<'p>, emit_context: &'p mut EmitContext) -> Printer<'p> {
    new_printer(
        a,
        PrinterOptions::default(),
        PrintHandlers::default(),
        emit_context,
    )
}

fn create_printer_with_remove_comments<'p>(
    a: Ast<'p>,
    emit_context: &'p mut EmitContext,
) -> Printer<'p> {
    new_printer(
        a,
        PrinterOptions {
            remove_comments: true,
            ..PrinterOptions::default()
        },
        PrintHandlers::default(),
        emit_context,
    )
}

fn create_printer_with_remove_comments_omit_trailing_semicolon<'p>(
    a: Ast<'p>,
    emit_context: &'p mut EmitContext,
) -> Printer<'p> {
    new_printer(
        a,
        PrinterOptions {
            remove_comments: true,
            omit_trailing_semicolon: true,
            ..PrinterOptions::default()
        },
        PrintHandlers::default(),
        emit_context,
    )
}

fn create_printer_with_remove_comments_omit_trailing_semicolon_never_ascii_escape<'p>(
    a: Ast<'p>,
    emit_context: &'p mut EmitContext,
) -> Printer<'p> {
    new_printer(
        a,
        PrinterOptions {
            remove_comments: true,
            omit_trailing_semicolon: true,
            never_ascii_escape: true,
            ..PrinterOptions::default()
        },
        PrintHandlers::default(),
        emit_context,
    )
}

fn to_node_builder_flags(flags: TypeFormatFlags) -> Flags {
    Flags((flags & TypeFormatFlags::NODE_BUILDER_FLAGS_MASK).0)
}

impl<'a> Checker<'a> {
    pub fn type_to_string_exported(&mut self, t: TypeId) -> Vec<u8> {
        self.type_to_string(t, NodeId::NIL)
    }

    pub fn type_to_string(&mut self, t: TypeId, enclosing_declaration: NodeId) -> Vec<u8> {
        self.type_to_string_ex(
            t,
            enclosing_declaration,
            TypeFormatFlags::ALLOW_UNIQUE_ES_SYMBOL_TYPE
                | TypeFormatFlags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE,
            None,
        )
    }

    pub fn type_to_string_ex_exported(
        &mut self,
        t: TypeId,
        enclosing_declaration: NodeId,
        flags: TypeFormatFlags,
        vc: Option<&mut VerbosityContext>,
    ) -> Vec<u8> {
        self.type_to_string_ex(t, enclosing_declaration, flags, vc)
    }

    pub fn type_to_string_ex(
        &mut self,
        t: TypeId,
        enclosing_declaration: NodeId,
        flags: TypeFormatFlags,
        mut vc: Option<&mut VerbosityContext>,
    ) -> Vec<u8> {
        // Serialization of types can lead to (lazy) resolution of members, which can cause diagnostics that again require serialization of types: after a certain number of recursive invocations the function simply returns "?".
        if self.serialization_level >= MAX_SERIALIZATION_LEVEL {
            return b"?".to_vec();
        }
        let mut new_line: &[u8] = b"";
        if flags.intersects(TypeFormatFlags::MULTILINE_OBJECT_LITERALS) {
            new_line = b"\n";
        }
        let mut writer = new_text_writer(new_line, 0);
        let no_truncation = (vc.as_deref().is_none_or(|vc| vc.max_truncation_length == 0)
            && self.compiler_options.no_error_truncation.is_true())
            || flags.intersects(TypeFormatFlags::NO_TRUNCATION);
        let mut combined_flags = to_node_builder_flags(flags) | Flags::IGNORE_ERRORS;
        if no_truncation {
            combined_flags |= Flags::NO_TRUNCATION;
        }
        let node_builder = self.get_node_builder();
        let old_verbosity = self.node_builder.verbosity;
        self.node_builder.verbosity = vc.as_deref().copied();
        self.serialization_level += 1;
        let type_node = node_builder.type_to_type_node(
            self,
            t,
            enclosing_declaration,
            combined_flags,
            InternalFlags::NONE,
            None,
        );
        self.serialization_level -= 1;
        // `nodeBuilder.verbosity = vc` shares the caller's record upstream: the outputs are copied back before the old one is restored.
        if let (Some(vc), Some(used)) = (vc.as_deref_mut(), self.node_builder.verbosity) {
            *vc = used;
        }
        self.node_builder.verbosity = old_verbosity;
        if type_node.is_nil() {
            self.fail::<()>("should always get typenode");
            return Vec::new();
        }
        // The unresolved type gets a synthesized comment on `any` to hint to users that it's not a plain `any`: otherwise comments are always stripped.
        let a = self.ast;
        let is_unresolved = t == self.unresolved_type;
        let mut source_file = NodeId::NIL;
        if !enclosing_declaration.is_nil() {
            source_file = get_source_file_of_node(a, enclosing_declaration);
        }
        {
            let emit_context = node_builder.emit_context(self);
            let mut p = if is_unresolved {
                create_printer_with_defaults(a, emit_context)
            } else {
                create_printer_with_remove_comments(a, emit_context)
            };
            p.write(type_node, source_file, &mut *writer);
        }
        let result = writer.string();
        let mut max_length = DEFAULT_MAXIMUM_TRUNCATION_LENGTH * 2;
        if let Some(vc) = vc.as_deref() {
            if vc.max_truncation_length > 0 {
                // hard cutoff matching Strada's absoluteMaximumLength
                max_length = vc.max_truncation_length * 10;
            }
        }
        if no_truncation {
            max_length = NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH * 2;
        }
        if max_length > 0 && !result.is_empty() && result.len() as isize >= max_length {
            if let Some(vc) = vc.as_deref_mut() {
                vc.truncated = true;
            }
            let keep = usize::try_from(max_length - b"...".len() as isize).unwrap_or(0);
            let mut truncated = result.get(..keep).unwrap_or(result).to_vec();
            truncated.extend_from_slice(b"...");
            return truncated;
        }
        result.to_vec()
    }

    pub fn symbol_to_string_exported(&mut self, s: SymbolId) -> Vec<u8> {
        self.symbol_to_string(s)
    }

    pub fn symbol_to_string(&mut self, symbol: SymbolId) -> Vec<u8> {
        self.symbol_to_string_ex(
            symbol,
            NodeId::NIL,
            SymbolFlags::ALL,
            SymbolFormatFlags::ALLOW_ANY_NODE_KIND,
        )
    }

    pub fn symbol_to_string_ex(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
        flags: SymbolFormatFlags,
    ) -> Vec<u8> {
        let mut writer = get_single_line_string_writer();
        let mut node_flags = Flags::IGNORE_ERRORS;
        let mut internal_node_flags = InternalFlags::NONE;
        if flags.intersects(SymbolFormatFlags::USE_ONLY_EXTERNAL_ALIASING) {
            node_flags |= Flags::USE_ONLY_EXTERNAL_ALIASING;
        }
        if flags.intersects(SymbolFormatFlags::WRITE_TYPE_PARAMETERS_OR_ARGUMENTS) {
            node_flags |= Flags::WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME;
        }
        if flags.intersects(SymbolFormatFlags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE) {
            node_flags |= Flags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE;
        }
        if flags.intersects(SymbolFormatFlags::DO_NOT_INCLUDE_SYMBOL_CHAIN) {
            internal_node_flags |= InternalFlags::DO_NOT_INCLUDE_SYMBOL_CHAIN;
        }
        if flags.intersects(SymbolFormatFlags::WRITE_COMPUTED_PROPS) {
            internal_node_flags |= InternalFlags::WRITE_COMPUTED_PROPS;
        }
        let node_builder = self.get_node_builder();
        let a = self.ast;
        let mut source_file = NodeId::NIL;
        if !enclosing_declaration.is_nil() {
            source_file = get_source_file_of_node(a, enclosing_declaration);
        }
        // add neverAsciiEscape for GH#39027
        let never_ascii_escape =
            !enclosing_declaration.is_nil() && a.kind(enclosing_declaration) == Kind::SourceFile;
        let entity = if flags.intersects(SymbolFormatFlags::ALLOW_ANY_NODE_KIND) {
            node_builder.symbol_to_node(
                self,
                symbol,
                meaning,
                enclosing_declaration,
                node_flags,
                internal_node_flags,
                None,
            )
        } else {
            node_builder.symbol_to_entity_name(
                self,
                symbol,
                meaning,
                enclosing_declaration,
                node_flags,
                internal_node_flags,
                None,
            )
        };
        let emit_context = node_builder.emit_context(self);
        let mut printer_ = if never_ascii_escape {
            create_printer_with_remove_comments_omit_trailing_semicolon_never_ascii_escape(
                a,
                emit_context,
            )
        } else {
            create_printer_with_remove_comments_omit_trailing_semicolon(a, emit_context)
        };
        printer_.write(entity, source_file, &mut *writer);
        writer.string().to_vec()
    }

    pub fn signature_to_string(&mut self, signature: SignatureId) -> Vec<u8> {
        self.signature_to_string_ex(signature, NodeId::NIL, TypeFormatFlags::NONE, None)
    }

    pub fn signature_to_string_ex(
        &mut self,
        signature: SignatureId,
        enclosing_declaration: NodeId,
        flags: TypeFormatFlags,
        mut vc: Option<&mut VerbosityContext>,
    ) -> Vec<u8> {
        let is_constructor = self.signatures[signature]
            .flags
            .intersects(SignatureFlags::CONSTRUCT)
            && !flags.intersects(TypeFormatFlags::WRITE_CALL_STYLE_SIGNATURE);
        let sig_output = if flags.intersects(TypeFormatFlags::WRITE_ARROW_STYLE_SIGNATURE) {
            if is_constructor {
                Kind::ConstructorType
            } else {
                Kind::FunctionType
            }
        } else if is_constructor {
            Kind::ConstructSignature
        } else {
            Kind::CallSignature
        };
        let node_builder = self.get_node_builder();
        let old_verbosity = self.node_builder.verbosity;
        self.node_builder.verbosity = vc.as_deref().copied();
        let combined_flags = to_node_builder_flags(flags)
            | Flags::IGNORE_ERRORS
            | Flags::WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME;
        let sig = node_builder.signature_to_signature_declaration(
            self,
            signature,
            sig_output,
            enclosing_declaration,
            combined_flags,
            InternalFlags::NONE,
            None,
        );
        if let (Some(vc), Some(used)) = (vc.as_deref_mut(), self.node_builder.verbosity) {
            *vc = used;
        }
        self.node_builder.verbosity = old_verbosity;
        let a = self.ast;
        let mut source_file = NodeId::NIL;
        if !enclosing_declaration.is_nil() {
            source_file = get_source_file_of_node(a, enclosing_declaration);
        }
        let emit_context = node_builder.emit_context(self);
        let mut p = create_printer_with_remove_comments_omit_trailing_semicolon_never_ascii_escape(
            a,
            emit_context,
        );
        if flags.intersects(TypeFormatFlags::MULTILINE_OBJECT_LITERALS) {
            let mut writer = new_text_writer(b"\n", 0);
            p.write(sig, source_file, &mut *writer);
            return writer.string().to_vec();
        }
        let mut writer = get_single_line_string_writer();
        p.write(sig, source_file, &mut *writer);
        writer.string().to_vec()
    }

    pub fn type_predicate_to_string(&mut self, type_predicate: TypePredicateId) -> Vec<u8> {
        self.type_predicate_to_string_ex(
            type_predicate,
            NodeId::NIL,
            TypeFormatFlags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE,
        )
    }

    pub fn type_predicate_to_string_ex(
        &mut self,
        type_predicate: TypePredicateId,
        enclosing_declaration: NodeId,
        flags: TypeFormatFlags,
    ) -> Vec<u8> {
        let mut writer = get_single_line_string_writer();
        let node_builder = self.get_node_builder();
        let combined_flags = to_node_builder_flags(flags)
            | Flags::IGNORE_ERRORS
            | Flags::WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME;
        let predicate = node_builder.type_predicate_to_type_predicate_node(
            self,
            type_predicate,
            enclosing_declaration,
            combined_flags,
            InternalFlags::NONE,
            None,
        );
        let a = self.ast;
        let mut source_file = NodeId::NIL;
        if !enclosing_declaration.is_nil() {
            source_file = get_source_file_of_node(a, enclosing_declaration);
        }
        let emit_context = node_builder.emit_context(self);
        let mut printer_ = create_printer_with_remove_comments(a, emit_context);
        printer_.write(predicate, source_file, &mut *writer);
        writer.string().to_vec()
    }

    pub fn value_to_string(&self, value: &LiteralValue<'a>) -> Vec<u8> {
        value_to_string(value)
    }

    pub fn format_union_types(&mut self, types: &[TypeId], expanding_enum: bool) -> Vec<TypeId> {
        let mut result: Vec<TypeId> = Vec::new();
        let mut flags = TypeFlags::NONE;
        let mut i: usize = 0;
        while i < types.len() {
            let Some(&t) = types.get(i) else {
                break;
            };
            let t_flags = self.types[t].flags;
            flags |= t_flags;
            if !t_flags.intersects(TypeFlags::NULLABLE) {
                if t_flags.intersects(TypeFlags::BOOLEAN_LITERAL)
                    || (!expanding_enum && t_flags.intersects(TypeFlags::ENUM_LIKE))
                {
                    let base_type = if t_flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
                        self.boolean_type
                    } else {
                        self.get_base_type_of_enum_like_type(t)
                    };
                    if self.types[base_type].flags.intersects(TypeFlags::UNION) {
                        let base_types = self.as_union_type(base_type).types;
                        let count = base_types.as_slice().len();
                        if count > 0 && i + count <= types.len() {
                            let last_of_types = types.get(i + count - 1).copied();
                            let last_of_base = base_types.as_slice().get(count - 1).copied();
                            if let (Some(last_of_types), Some(last_of_base)) =
                                (last_of_types, last_of_base)
                            {
                                if self.get_regular_type_of_literal_type(last_of_types)
                                    == self.get_regular_type_of_literal_type(last_of_base)
                                {
                                    result.push(base_type);
                                    i += count;
                                    continue;
                                }
                            }
                        }
                    }
                }
                result.push(t);
            }
            i += 1;
        }
        if flags.intersects(TypeFlags::NULL) {
            result.push(self.null_type);
        }
        if flags.intersects(TypeFlags::UNDEFINED) {
            result.push(self.undefined_type);
        }
        result
    }
}
