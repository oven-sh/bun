//! `ts.Symbol` and `ts.Signature`.

use super::super::symbols::AliasTarget;
use super::*;

/// What makes a symbol the one it is.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(super) enum Key<'p> {
    /// `getMergedSymbol` of a symbol of the binder.
    Symbol(Sym),
    /// What `instantiateSymbol` made of that member for the table of that type.
    Instantiated(Sym, TypeId),
    /// A property that has no symbol of the binder, as it is read with that mapper.
    Property(&'p PropSource<'p>, Atom, MapperId),
    /// `IndexInfo.indexSymbol` of the index signature of that type.
    Index(TypeId, (FileId, MemberId)),
    /// `signature.thisParameter` of that function.
    ThisParameter(FileId, FnId),
    /// `__object`, `__type`, `__function`: the symbol that only that node declares.
    Anonymous(FileId, Node),
    /// What that member of an object literal declares. The property of the type of the literal is
    /// another symbol, which `checkObjectLiteral` makes.
    LiteralMember(FileId, PropId),
    /// `signature.parameters[index]`
    Parameter(SigId, u32),
    /// The `prototype` of that class.
    Prototype(Sym),
    /// The `default` that `createDefaultPropertyWrapperForModule` creates for that module.
    SyntheticDefault(Sym),
    /// A symbol without declarations that is known by its name: `arguments`, `require`, a type
    /// name that does not resolve.
    Undeclared(Atom),
    /// One that is the same as no other.
    Unique(u32),
}

pub(super) struct Entry<'p> {
    pub(super) key: Key<'p>,
    /// The property that it was found as, and the mapper to read it with.
    pub(super) prop: Option<(&'p Prop<'p>, MapperId)>,
    /// `symbol.name`, where it is not that of the key: of a late bound member, of a type name that
    /// does not resolve.
    pub(super) name: Atom,
}

/// `removeFileExtension`
fn remove_file_extension(path: &[u8]) -> &[u8] {
    const EXTENSIONS_TO_REMOVE: [&[u8]; 12] = [
        b".d.ts", b".d.mts", b".d.cts", b".mjs", b".mts", b".cjs", b".cts", b".ts", b".js", b".tsx", b".jsx", b".json",
    ];
    EXTENSIONS_TO_REMOVE.iter().find_map(|extension| path.strip_suffix(*extension)).unwrap_or(path)
}

fn flags_of_literal_member(kind: PropKind) -> SymbolFlags {
    match kind {
        PropKind::Method => SymbolFlags::METHOD,
        PropKind::Getter => SymbolFlags::GET_ACCESSOR,
        PropKind::Setter => SymbolFlags::SET_ACCESSOR,
        _ => SymbolFlags::PROPERTY,
    }
}

impl<'c, 'p, 's> Services<'c, 'p, 's> {
    pub(super) fn intern_symbol(&mut self, key: Key<'c>, prop: Option<(&'c Prop<'c>, MapperId)>) -> SymbolRef {
        if let Some(&id) = self.symbol_ids.get(&key) {
            if let Some(entry) = self.symbols.get_mut(id.0 as usize)
                && entry.prop.is_none()
            {
                entry.prop = prop;
            }
            return id;
        }
        let id = SymbolRef(self.symbols.len() as u32);
        self.symbols.push(Entry {
            key,
            prop,
            name: Atom::NONE,
        });
        self.symbol_ids.insert(key, id);
        id
    }

    /// The symbol that `symbol` is, or is merged into.
    pub(super) fn symbol(&mut self, symbol: Sym) -> SymbolRef {
        let symbol = self.c.files().canonical(symbol);
        self.intern_symbol(Key::Symbol(symbol), None)
    }

    /// The same with the name `name`.
    pub(super) fn named_symbol(&mut self, key: Key<'c>, name: Atom) -> SymbolRef {
        let id = self.intern_symbol(key, None);
        if let Some(entry) = self.symbols.get_mut(id.0 as usize) {
            entry.name = name;
        }
        id
    }

    pub(super) fn unique_symbol(&mut self) -> SymbolRef {
        let key = Key::Unique(self.symbols.len() as u32);
        self.intern_symbol(key, None)
    }

    /// The symbol that the property `prop` is, where `mapper` is what came with it.
    pub(super) fn symbol_of_prop(&mut self, prop: &'c Prop<'c>, mapper: MapperId) -> SymbolRef {
        let key = match prop.source {
            PropSource::Symbol(symbol) => {
                let symbol = self.c.files().canonical(symbol);
                let composed = self.c.compose(prop.mapper, mapper);
                match self.c.instantiation_of_member(symbol, composed) {
                    Some(instantiation) => Key::Instantiated(symbol, instantiation),
                    None => Key::Symbol(symbol),
                }
            }
            ref source => Key::Property(source, prop.name, self.c.compose(prop.mapper, mapper)),
        };
        self.intern_symbol(key, Some((prop, mapper)))
    }

    #[inline]
    fn entry(&self, symbol: SymbolRef) -> Option<(Key<'c>, Option<(&'c Prop<'c>, MapperId)>)> {
        self.symbols.get(symbol.0 as usize).map(|entry| (entry.key, entry.prop))
    }

    /// The symbol of the binder, if it is one.
    pub(super) fn sym_of(&self, symbol: SymbolRef) -> Option<Sym> {
        match self.entry(symbol)?.0 {
            Key::Symbol(symbol) | Key::Instantiated(symbol, _) => Some(symbol),
            _ => None,
        }
    }

    /// The property that `symbol` is, made up from its declaration if it was not found as one.
    fn prop_of(&mut self, symbol: SymbolRef) -> Option<(&'c Prop<'c>, MapperId)> {
        let (key, prop) = self.entry(symbol)?;
        if prop.is_some() {
            return prop;
        }
        let Key::Symbol(sym) = key else {
            return None;
        };
        if !self.c.is_member_symbol(sym) {
            return None;
        }
        let flags = self.c.flags_of_property(sym);
        let mut prop_flags = PropFlags::empty();
        if flags.contains(SymFlags::METHOD) {
            prop_flags |= PropFlags::METHOD;
        }
        if flags.intersects(SymFlags::ACCESSOR) {
            prop_flags |= PropFlags::ACCESSOR;
        }
        let declared = match self.c.value_declaration_of_property(sym) {
            Some((file, Decl::Member(member))) => self.c.hir(file)[member].flags,
            Some((file, Decl::ParameterProperty(parameter))) => self.c.hir(file)[parameter].flags,
            _ => Flags::empty(),
        };
        for (flag, prop_flag) in [
            (Flags::OPTIONAL, PropFlags::OPTIONAL),
            (Flags::READONLY, PropFlags::READONLY),
            (Flags::PRIVATE, PropFlags::PRIVATE),
            (Flags::PROTECTED, PropFlags::PROTECTED),
            (Flags::ABSTRACT, PropFlags::ABSTRACT),
        ] {
            if declared.contains(flag) {
                prop_flags |= prop_flag;
            }
        }
        let prop: &'c Prop<'c> = self.arena.alloc(Prop {
            name: self.c.files().symbol(sym).name,
            flags: prop_flags,
            source: PropSource::Symbol(sym),
            mapper: MapperId::IDENTITY,
        });
        if let Some(entry) = self.symbols.get_mut(symbol.0 as usize) {
            entry.prop = Some((prop, MapperId::IDENTITY));
        }
        Some((prop, MapperId::IDENTITY))
    }

    /// `symbol.name`, spelled as TypeScript spells it.
    fn name_as_in_typescript(&self, name: Atom) -> &'c [u8] {
        let internal: &'static [u8] = match name {
            Atom::NONE => b"",
            known::anonymous_function => b"__function",
            known::object_literal => b"__object",
            known::type_literal => b"__type",
            known::computed => b"__computed",
            known::missing => b"__missing",
            known::constructor_declaration => b"__constructor",
            known::call_signature => b"__call",
            known::construct_signature => b"__new",
            known::index_signature => b"__index",
            _ => {
                let bytes: &'p [u8] = self.c.atoms().bytes(name);
                return match bytes {
                    // `symbolName`: `#x`
                    _ if bytes.starts_with(crate::atom::PRIVATE_NAME_PREFIX) => crate::atom::written_name(bytes),
                    [0xFE, rest @ ..] => self.list(&cat!(b"__", rest)),
                    _ => bytes,
                };
            }
        };
        internal
    }

    // ───────────────────────────── fields ─────────────────────────────

    pub fn symbol_info(&mut self, symbol: SymbolRef) -> SymbolInfo<'c> {
        let mut info = SymbolInfo {
            name: b"",
            flags: SymbolFlags::empty(),
            check_flags: CheckFlags::empty(),
            local: None,
        };
        let Some((key, prop)) = self.entry(symbol) else {
            return info;
        };
        match key {
            Key::Symbol(sym) | Key::Instantiated(sym, _) => {
                let files = self.c.files();
                info.name = self.name_as_in_typescript(match prop {
                    // A late bound member has the name of the property.
                    Some((prop, _)) if prop.name.is_some() => prop.name,
                    _ => files.symbol(sym).name,
                });
                let flags = match prop.is_some() || self.c.is_member_symbol(sym) {
                    true => self.c.flags_of_property(sym),
                    false => files.flags(sym),
                };
                info.flags = SymbolFlags::from(flags);
                if sym == files.prototype_symbol {
                    info.flags |= SymbolFlags::PROTOTYPE;
                }
                if matches!(key, Key::Instantiated(..)) {
                    info.flags |= SymbolFlags::TRANSIENT;
                    info.check_flags |= CheckFlags::INSTANTIATED;
                }
                let is_local = sym.file == self.file && !flags.intersects(SymFlags::MERGED | SymFlags::TRANSIENT);
                info.local = (is_local && matches!(key, Key::Symbol(_))).then_some(sym.id);
                if prop.is_none() && self.is_optional_declaration(sym) {
                    info.flags |= SymbolFlags::OPTIONAL;
                }
                if info.name.is_empty() && flags.contains(SymFlags::CLASS) {
                    info.name = b"__class";
                }
                // The name of a module that is a file or has a string for its name is in quotes.
                if flags.intersects(SymFlags::MODULE) {
                    match files.decls_of(sym).first() {
                        Some(&(file, Decl::File)) => {
                            let path = files.module(file).file_name();
                            let path = remove_file_extension(path);
                            info.name = self.list(&cat!(b"\"", path, b"\""));
                        }
                        Some(&(file, Decl::Module(module))) if matches!(self.c.hir(file)[module].name, ModuleName::String(_)) => {
                            info.name = self.list(&cat!(b"\"", info.name, b"\""));
                        }
                        _ => {}
                    }
                }
            }
            Key::Property(source, name, _) => {
                info.name = match name {
                    Atom::NONE => b"__computed",
                    name => self.name_as_in_typescript(name),
                };
                info.flags = SymbolFlags::PROPERTY;
                match source {
                    PropSource::Literal(file, p) => {
                        info.flags |= flags_of_literal_member(self.c.hir(*file)[*p].kind) | SymbolFlags::TRANSIENT;
                    }
                    PropSource::Intersected(..) => {
                        info.flags |= SymbolFlags::TRANSIENT;
                        info.check_flags |= CheckFlags::SYNTHETIC_PROPERTY;
                    }
                    PropSource::Mapped(_, strips_optional, _) => {
                        info.flags |= SymbolFlags::TRANSIENT;
                        info.check_flags |= CheckFlags::MAPPED;
                        if *strips_optional {
                            info.check_flags |= CheckFlags::STRIP_OPTIONAL;
                        }
                    }
                    PropSource::ReverseMapped(..) => {
                        info.flags |= SymbolFlags::TRANSIENT;
                        info.check_flags |= CheckFlags::REVERSE_MAPPED;
                    }
                    // `bindClassLikeDeclaration`
                    PropSource::Type(_) if name == known::prototype => info.flags |= SymbolFlags::PROTOTYPE,
                    _ => info.flags |= SymbolFlags::TRANSIENT,
                }
            }
            Key::LiteralMember(file, p) => {
                let member = &self.c.hir(file)[p];
                info.flags = flags_of_literal_member(member.kind);
                info.name = match self.c.declared_member_name(file, member.key) {
                    Some(name) => self.name_as_in_typescript(name),
                    None => b"__computed",
                };
            }
            Key::Index(..) => {
                info.name = b"__index";
                info.flags = SymbolFlags::SIGNATURE | SymbolFlags::TRANSIENT;
            }
            Key::ThisParameter(..) => {
                info.name = b"this";
                info.flags = SymbolFlags::FUNCTION_SCOPED_VARIABLE;
            }
            Key::Anonymous(file, node) => {
                (info.name, info.flags) = match self.c.hir(file).kind(node) {
                    Kind::ObjectLiteralExpression | Kind::JsxAttributes => (&b"__object"[..], SymbolFlags::OBJECT_LITERAL),
                    Kind::ClassExpression => (&b"__class"[..], SymbolFlags::CLASS),
                    Kind::FunctionExpression | Kind::ArrowFunction => (&b"__function"[..], SymbolFlags::FUNCTION),
                    _ => (&b"__type"[..], SymbolFlags::TYPE_LITERAL),
                };
            }
            Key::Parameter(signature, index) => {
                info.flags = SymbolFlags::FUNCTION_SCOPED_VARIABLE;
                if let Some(parameter) = self.c.sig_params(signature).get(index as usize) {
                    info.name = match parameter.name {
                        // `bindParameter`: one whose name is a pattern.
                        Atom::NONE => self.list(format!("__{index}").as_bytes()),
                        name => self.name_as_in_typescript(name),
                    };
                    if parameter.declaration.is_none() {
                        info.flags |= SymbolFlags::TRANSIENT;
                        if parameter.optional {
                            info.flags |= SymbolFlags::OPTIONAL;
                        }
                    }
                }
            }
            Key::Prototype(_) => {
                info.name = b"prototype";
                info.flags = SymbolFlags::PROPERTY | SymbolFlags::PROTOTYPE;
            }
            Key::SyntheticDefault(_) => {
                info.name = b"default";
                info.flags = SymbolFlags::PROPERTY | SymbolFlags::TRANSIENT;
            }
            Key::Undeclared(name) => info.name = self.name_as_in_typescript(name),
            Key::Unique(_) => {
                info.name = b"__index";
                info.flags = SymbolFlags::SIGNATURE | SymbolFlags::TRANSIENT;
            }
        }
        if let Some(name) = self.symbols.get(symbol.0 as usize).map(|entry| entry.name).filter(|name| name.is_some()) {
            info.name = self.name_as_in_typescript(name);
            // `getUnresolvedSymbolForEntityName`
            if matches!(key, Key::Undeclared(_)) {
                info.flags = SymbolFlags::TYPE_ALIAS | SymbolFlags::TRANSIENT;
            }
        }
        if let Some((prop, _)) = prop {
            let is_declared = matches!(key, Key::Symbol(_) | Key::Instantiated(..) | Key::LiteralMember(..))
                || matches!(prop.source, PropSource::Literal(..));
            if !is_declared && prop.flags.contains(PropFlags::METHOD) {
                // `createUnionOrIntersectionProperty` makes a property of methods.
                match info.check_flags.contains(CheckFlags::SYNTHETIC_PROPERTY) {
                    true => {
                        info.check_flags = (info.check_flags - CheckFlags::SYNTHETIC_PROPERTY) | CheckFlags::SYNTHETIC_METHOD;
                    }
                    false => info.flags = (info.flags - SymbolFlags::PROPERTY) | SymbolFlags::METHOD,
                }
            }
            if prop.flags.contains(PropFlags::OPTIONAL) {
                info.flags |= SymbolFlags::OPTIONAL;
            }
            if info.flags.contains(SymbolFlags::TRANSIENT) {
                for (flag, check_flag) in [
                    (PropFlags::READONLY, CheckFlags::READONLY),
                    (PropFlags::READ_PARTIAL, CheckFlags::READ_PARTIAL),
                    (PropFlags::WRITE_PARTIAL, CheckFlags::WRITE_PARTIAL),
                    (PropFlags::HAS_NON_UNIFORM_TYPE, CheckFlags::HAS_NON_UNIFORM_TYPE),
                    (PropFlags::HAS_LITERAL_TYPE, CheckFlags::HAS_LITERAL_TYPE),
                    (PropFlags::PRIVATE, CheckFlags::CONTAINS_PRIVATE),
                    (PropFlags::PROTECTED, CheckFlags::CONTAINS_PROTECTED),
                ] {
                    if prop.flags.contains(flag) {
                        info.check_flags |= check_flag;
                    }
                }
            }
        }
        info
    }

    /// The `?` of the member or the parameter property that declares `sym`.
    fn is_optional_declaration(&mut self, sym: Sym) -> bool {
        match self.c.files().value_declaration(sym) {
            Some((file, Decl::Member(member))) => self.c.hir(file)[member].flags.contains(Flags::OPTIONAL),
            Some((file, Decl::ParameterProperty(parameter))) => self.c.hir(file)[parameter].flags.contains(Flags::OPTIONAL),
            _ => false,
        }
    }

    fn node_of_declaration(&self, (file, decl): (FileId, Decl)) -> NodeRef {
        NodeRef {
            file,
            node: self.c.hir(file).node(decl),
        }
    }

    fn push_declarations_of_sym(&mut self, sym: Sym, out: &mut SmallVec<[NodeRef; 4]>) {
        let files = self.c.files();
        let declarations = match files.flags(sym).intersects(SymFlags::CLASS_MEMBER) {
            true => self.c.declarations_of_property(sym),
            false => files.decls_of(sym),
        };
        out.extend(declarations.iter().map(|&it| self.node_of_declaration(it)));
    }

    fn push_declarations_of_prop(&mut self, prop: &Prop, depth: u32, out: &mut SmallVec<[NodeRef; 4]>) {
        if depth > 64 {
            return;
        }
        match &prop.source {
            PropSource::Literal(file, property) => {
                let declarations = self.c.declarations_of_member(*file, Decl::Property(*property));
                out.extend(declarations.iter().map(|&it| self.node_of_declaration(it)));
            }
            PropSource::Symbol(symbol) => self.push_declarations_of_sym(*symbol, out),
            // `propSet` has a symbol once.
            PropSource::Intersected(_, parts) => {
                for (index, part) in parts.iter().enumerate() {
                    if !parts[..index].contains(part) {
                        self.push_declarations_of_prop(part, depth + 1, out);
                    }
                }
            }
            PropSource::Copy(_, parts, _) | PropSource::ReverseMapped(_, parts) => {
                for part in parts.iter() {
                    self.push_declarations_of_prop(part, depth + 1, out);
                }
            }
            PropSource::Mapped(..) => {
                for part in prop.declared_by_modifiers_property() {
                    self.push_declarations_of_prop(part, depth + 1, out);
                }
            }
            PropSource::Type(_) => {}
        }
    }

    pub fn declarations(&mut self, symbol: SymbolRef) -> &'c [NodeRef] {
        let Some((key, prop)) = self.entry(symbol) else {
            return &[];
        };
        let mut out: SmallVec<[NodeRef; 4]> = SmallVec::new();
        match key {
            Key::Symbol(sym) | Key::Instantiated(sym, _) => self.push_declarations_of_sym(sym, &mut out),
            Key::Property(..) | Key::LiteralMember(..) => {
                if let Some((prop, _)) = prop {
                    self.push_declarations_of_prop(prop, 0, &mut out);
                }
            }
            Key::Index(_, (file, member)) => out.push(self.node_of_declaration((file, Decl::Member(member)))),
            Key::ThisParameter(file, function) => {
                let hir = self.c.hir(file);
                out.push(NodeRef {
                    file,
                    node: hir.node(hir[function].this_param),
                });
            }
            Key::Anonymous(file, node) => out.push(NodeRef { file, node }),
            Key::Parameter(signature, index) => {
                if let Some((file, parameter)) = self.c.sig_params(signature).get(index as usize).and_then(|it| it.declaration) {
                    out.push(NodeRef {
                        file,
                        node: self.c.hir(file).node(parameter),
                    });
                }
            }
            Key::Prototype(_) | Key::SyntheticDefault(_) | Key::Undeclared(_) | Key::Unique(_) => {}
        }
        self.list(&out)
    }

    pub fn value_declaration(&mut self, symbol: SymbolRef) -> Option<NodeRef> {
        let (key, prop) = self.entry(symbol)?;
        match key {
            Key::Symbol(sym) | Key::Instantiated(sym, _) => {
                let declaration = match self.c.files().flags(sym).intersects(SymFlags::CLASS_MEMBER) {
                    true => self.c.value_declaration_of_property(sym),
                    false => self.c.files().value_declaration(sym),
                };
                declaration.map(|it| self.node_of_declaration(it))
            }
            Key::Property(..) | Key::LiteralMember(..) => {
                let declaration = self.c.value_declaration_of_prop(prop?.0)?;
                Some(self.node_of_declaration(declaration))
            }
            Key::Index(..) | Key::Prototype(_) | Key::SyntheticDefault(_) | Key::Undeclared(_) | Key::Unique(_) => None,
            Key::ThisParameter(..) | Key::Anonymous(..) | Key::Parameter(..) => self.declarations(symbol).first().copied(),
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    pub fn type_of_symbol(&mut self, symbol: SymbolRef) -> TypeId {
        let Some((key, _)) = self.entry(symbol) else {
            return TypeId::ERROR;
        };
        if let Some((prop, mapper)) = self.prop_of(symbol) {
            return self.c.type_of_prop(prop, mapper);
        }
        match key {
            Key::Symbol(sym) | Key::Instantiated(sym, _) => self.c.type_of_symbol(sym),
            Key::ThisParameter(file, function) => self.c.type_of_this_parameter(file, function),
            Key::Anonymous(file, node) => self.type_at_location(NodeRef { file, node }),
            Key::Parameter(signature, index) => {
                let parameters = self.c.sig_params(signature);
                let Some(parameter) = parameters.get(index as usize) else {
                    return TypeId::ERROR;
                };
                // What the signature has is `getTypeOfParameter`, which adds `undefined` for an
                // initializer. The variable does not have it.
                if let Some((file, declaration)) = parameter.declaration
                    && self.c.hir(file)[declaration].default.is_some()
                {
                    let origin = self.c.types().sig_origin(signature);
                    let mapper = self.c.sig_decl(origin).map_or(MapperId::IDENTITY, |it| it.2);
                    let declared = self.c.type_of_param(file, declaration);
                    return self.c.instantiate(declared, mapper);
                }
                parameter.ty
            }
            Key::Prototype(class) => self.c.declared_type(class),
            Key::SyntheticDefault(module) => {
                let value = self.c.files().module_value(module);
                self.c.type_of_symbol(value)
            }
            Key::Index(ty, declaration) => {
                let infos = self.index_infos_of_type(ty);
                let node = self.node_of_declaration((declaration.0, Decl::Member(declaration.1)));
                infos.iter().find(|it| it.declaration == Some(node)).map_or(TypeId::ERROR, |it| it.ty)
            }
            Key::Property(..) | Key::LiteralMember(..) | Key::Undeclared(_) | Key::Unique(_) => TypeId::ERROR,
        }
    }

    pub fn declared_type_of_symbol(&mut self, symbol: SymbolRef) -> TypeId {
        match self.sym_of(symbol) {
            Some(sym) => self.c.declared_type(sym),
            None => TypeId::ERROR,
        }
    }

    /// `getTypeOfSymbolAtLocation`: if `node` is a reference to `symbol`, the narrowed type of
    /// that reference. Otherwise `getNonMissingTypeOfSymbol`.
    pub fn type_of_symbol_at_location(&mut self, symbol: SymbolRef, node: NodeRef) -> TypeId {
        if let Some((hir, at)) = self.valid(node) {
            // The name of a property access stands for the access.
            let reference = match (hir.kind(at), hir.kind(hir.parent(at))) {
                (Kind::Identifier | Kind::PrivateIdentifier, Kind::PropertyAccessExpression)
                    if hir.name(hir.parent(at)) == at =>
                {
                    hir.parent(at)
                }
                _ => at,
            };
            let is_reference = matches!(hir.kind(at), Kind::Identifier | Kind::PrivateIdentifier)
                && hir.is_expression_node(reference)
                && !hir.is_declaration_name(at);
            let reference = NodeRef {
                node: reference,
                ..node
            };
            if is_reference && self.symbol_at_location(reference) == Some(symbol) {
                return self.type_at_location(reference);
            }
            // The name of a declaration, which may be assigned a narrower type.
            if hir.is_declaration_name(at) && self.symbol_at_location(node) == Some(symbol) {
                return self.type_of_symbol(symbol);
            }
        }
        let ty = self.type_of_symbol(symbol);
        let is_optional = self.symbol_info(symbol).flags.contains(SymbolFlags::OPTIONAL);
        self.c.remove_missing_type(ty, is_optional)
    }

    // ───────────────────────────── other symbols ─────────────────────────────

    pub fn symbol_of_local(&mut self, symbol: SymbolId) -> Option<SymbolRef> {
        if symbol.idx() >= self.c.bound(self.file).symbols.len() {
            return None;
        }
        let sym = self.c.files().sym(self.file, symbol);
        Some(self.symbol(sym))
    }

    pub fn symbol_op(&mut self, op: SymbolOp, symbol: SymbolRef) -> Option<SymbolRef> {
        let (key, prop) = self.entry(symbol)?;
        let files = self.c.files();
        match (op, key) {
            (SymbolOp::Merged, _) => Some(symbol),
            (SymbolOp::Aliased, Key::Symbol(sym)) => {
                if !files.flags(sym).contains(SymFlags::ALIAS) {
                    return None;
                }
                match self.c.resolve_alias(sym) {
                    AliasTarget::Symbol(target) => Some(self.symbol(target)),
                    AliasTarget::Property(owner, name, _) => match self.c.get_property_of_type(owner, name) {
                        Some((prop, mapper)) => Some(self.symbol_of_prop(prop, mapper)),
                        None => Some(self.symbol(files.unknown_symbol)),
                    },
                    AliasTarget::Unknown => Some(self.symbol(files.unknown_symbol)),
                }
            }
            (SymbolOp::ImmediateAliased, Key::Symbol(sym)) => {
                if !files.flags(sym).contains(SymFlags::ALIAS) {
                    return None;
                }
                match files.alias_target(sym) {
                    Some(target) => Some(self.symbol(target)),
                    None => {
                        let prop = self.c.property_of_alias(sym)?;
                        Some(self.symbol_of_prop(prop, MapperId::IDENTITY))
                    }
                }
            }
            (SymbolOp::ExportSymbol, Key::Symbol(sym)) => {
                let exported = files.symbol(sym).export_symbol.some()?;
                Some(self.symbol(files.sym(sym.file, exported)))
            }
            (SymbolOp::Parent, Key::Symbol(sym) | Key::Instantiated(sym, _)) => {
                let parent = match files.parent_of_symbol(sym) {
                    Some(parent) => parent,
                    None => match files.value_declaration(sym)? {
                        (file, Decl::Member(member)) => self.c.symbol_of_member_owner(file, member)?,
                        _ => self.c.declaring_class_of_symbol(sym)?,
                    },
                };
                Some(self.symbol(parent))
            }
            (SymbolOp::Parent, Key::Property(..)) => {
                let class = self.c.declaring_class(prop?.0)?;
                Some(self.symbol(class))
            }
            (SymbolOp::Parent, Key::Prototype(parent) | Key::SyntheticDefault(parent)) => Some(self.symbol(parent)),
            _ => None,
        }
    }

    pub fn symbol_table(&mut self, table: SymbolTable, symbol: SymbolRef) -> &'c [SymbolRef] {
        let Some(sym) = self.sym_of(symbol) else {
            return &[];
        };
        let files = self.c.files();
        let symbols: Vec<Sym> = match table {
            SymbolTable::ExportsOfModule => files.exports_of_module(sym).iter().map(|it| it.1).collect(),
            SymbolTable::Exports => files.each_export(sym).map(|it| it.1).collect(),
            SymbolTable::Members => files.members_in_table(sym).iter().map(|it| it.1).collect(),
        };
        let symbols: Vec<SymbolRef> = symbols.into_iter().map(|it| self.symbol(it)).collect();
        self.list(&symbols)
    }

    pub fn is_unknown_symbol(&mut self, symbol: SymbolRef) -> bool {
        self.sym_of(symbol) == Some(self.c.files().unknown_symbol)
    }

    pub fn is_readonly_symbol(&mut self, symbol: SymbolRef) -> bool {
        if let Some((prop, _)) = self.prop_of(symbol) {
            return self.c.is_readonly_symbol(prop);
        }
        // `isReadonlySymbol`: a `const`, an enum member.
        match self.sym_of(symbol) {
            Some(sym) => {
                let flags = self.c.files().flags(sym);
                flags.contains(SymFlags::ENUM_MEMBER) || flags.contains(SymFlags::VARIABLE | SymFlags::CONST)
                    || flags.intersects(SymFlags::VARIABLE) && flags.contains(SymFlags::CONST)
            }
            None => false,
        }
    }

    pub fn is_spreadable_property(&mut self, symbol: SymbolRef) -> bool {
        match self.prop_of(symbol) {
            Some((prop, _)) => self.c.is_spreadable_property(prop),
            None => false,
        }
    }

    pub fn declaration_modifier_flags_from_symbol(&mut self, symbol: SymbolRef) -> ModifierFlags {
        if let Some((prop, _)) = self.prop_of(symbol) {
            let mut flags = self.c.get_declaration_modifier_flags_from_symbol_ex(prop, false);
            flags.remove(Flags::AMBIENT);
            return ModifierFlags::from(flags);
        }
        match self.entry(symbol) {
            // "a prototype property is public and static"
            Some((Key::Prototype(_), _)) => ModifierFlags::PUBLIC | ModifierFlags::STATIC,
            _ => match self.value_declaration(symbol) {
                Some(declaration) => self.node_modifier_flags(declaration),
                None => ModifierFlags::empty(),
            },
        }
    }

    pub fn symbol_to_string(&mut self, symbol: SymbolRef) -> Vec<u8> {
        match self.entry(symbol) {
            Some((Key::Symbol(sym) | Key::Instantiated(sym, _), None)) => self.c.symbol_to_string(sym),
            Some((_, Some((prop, _)))) => self.c.prop_to_string(prop),
            _ => self.symbol_info(symbol).name.to_vec(),
        }
    }

    // ───────────────────────────── members of types ─────────────────────────────

    pub fn properties_of_type(&mut self, ty: TypeId) -> &'c [SymbolRef] {
        let ty = self.c.reduced_apparent_type_as_object(ty);
        let Some(members) = self.c.members(ty) else {
            return &[];
        };
        let shape: &'p Shape<'p> = members.shape();
        let mut symbols = Vec::with_capacity(shape.props.len());
        for prop in shape.props.iter() {
            symbols.push(self.symbol_of_prop(prop, members.mapper));
        }
        self.list(&symbols)
    }

    pub fn property_of_type(&mut self, ty: TypeId, name: &[u8]) -> Option<SymbolRef> {
        let name = self.property_name(name)?;
        let (prop, mapper) = self.c.get_property_of_type(ty, name)?;
        Some(self.symbol_of_prop(prop, mapper))
    }

    /// The atom of the name of a property, if any property can have that name. `__@iterator` is
    /// the name of the property whose key is `Symbol.iterator`.
    fn property_name(&self, name: &[u8]) -> Option<Atom> {
        match name.strip_prefix(b"__@") {
            Some(symbol) => self.c.atoms().lookup(&cat!(crate::atom::SYMBOL_NAME_PREFIX, symbol)),
            None => self.c.atoms().lookup(name),
        }
    }

    pub fn type_of_property_of_type(&mut self, ty: TypeId, name: &[u8]) -> Option<TypeId> {
        let name = self.property_name(name)?;
        self.c.type_of_property_of_type(ty, name)
    }

    pub fn type_of_property_or_index_signature_of_type(&mut self, ty: TypeId, name: &[u8]) -> Option<TypeId> {
        // A name that nothing in the program spells can still be a key of an index signature.
        let name = match name.strip_prefix(b"__@") {
            Some(_) => self.property_name(name)?,
            None => self.c.atoms().intern(name),
        };
        self.c.type_of_property_or_index_signature_of_type(ty, name)
    }

    // ───────────────────────────── signatures ─────────────────────────────

    pub fn signature_info(&mut self, signature: SigId) -> SignatureInfo<'c> {
        let parameters = self.c.sig_params(signature);
        let symbols: SmallVec<[SymbolRef; 4]> =
            (0..parameters.len() as u32).map(|index| self.intern_symbol(Key::Parameter(signature, index), None)).collect();
        let type_parameters = self.c.sig_type_params(signature);
        // `getDefaultConstructSignatures` clones the signature of the base class.
        let origin = self.c.default_construct_base_sig(signature).unwrap_or(signature);
        let origin = self.c.types().sig_origin(origin);
        let declaration = self.c.sig_decl(origin).map(|(file, function, _)| NodeRef {
            file,
            node: self.c.hir(file).node(function),
        });
        let this_parameter = self.c.sig_this_parameter(signature).and_then(|(_, declaring)| {
            let origin = self.c.types().sig_origin(declaring);
            let (file, function, _) = self.c.sig_decl(origin)?;
            Some(self.intern_symbol(Key::ThisParameter(file, function), None))
        });
        SignatureInfo {
            parameters: self.list(&symbols),
            type_parameters: self.list(&type_parameters),
            this_parameter,
            declaration,
            min_argument_count: Checker::min_args(&parameters) as u32,
            has_rest_parameter: parameters.last().is_some_and(|it| it.rest),
        }
    }

    pub fn return_type_of_signature(&mut self, signature: SigId) -> TypeId {
        self.c.sig_return(signature)
    }

    pub fn type_predicate_of_signature(&mut self, signature: SigId) -> Option<TypePredicateData<'p>> {
        let predicate = self.c.sig_predicate(signature)?;
        Some(TypePredicateData {
            kind: match (predicate.param, predicate.asserts) {
                (None, false) => TypePredicateKind::This,
                (None, true) => TypePredicateKind::AssertsThis,
                (Some(_), false) => TypePredicateKind::Identifier,
                (Some(_), true) => TypePredicateKind::AssertsIdentifier,
            },
            parameter_name: match predicate.name {
                Atom::NONE => b"",
                name => self.c.atoms().bytes(name),
            },
            parameter_index: predicate.param.and_then(|index| u32::try_from(index).ok()),
            ty: predicate.ty,
        })
    }

    pub fn type_at_position(&mut self, signature: SigId, index: u32) -> Option<TypeId> {
        let parameters = self.c.sig_params(signature);
        self.c.param_type_at(&parameters, index as usize)
    }

    pub fn signature_to_string(&mut self, signature: SigId) -> Vec<u8> {
        let mut out = Vec::new();
        self.c.write_signature(&mut out, signature);
        out
    }
}
