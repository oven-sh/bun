//! `ts.Symbol` and `ts.Signature`.

use super::super::symbols::AliasTarget;
use super::*;

/// A symbol's identity.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(super) enum Key<'p> {
    /// `getMergedSymbol` of a binder symbol.
    Symbol(Sym),
    /// The copy `instantiateSymbol` makes of this member for this type's member table.
    Instantiated(Sym, TypeId),
    /// A property without a binder symbol, as read with this mapper.
    Property(&'p PropSource<'p>, Atom, MapperId),
    /// `IndexInfo.indexSymbol` of this type's index signature.
    Index(TypeId, (FileId, MemberId)),
    /// `signature.thisParameter` of this function.
    ThisParameter(FileId, FnId),
    /// `__object`, `__type`, `__function`: the symbol that only this node declares.
    Anonymous(FileId, Node),
    /// The symbol this object literal member declares. The property of the literal's type is a
    /// different symbol, created by `checkObjectLiteral`.
    LiteralMember(FileId, PropId),
    /// `signature.parameters[index]`
    Parameter(SigId, u32),
    /// This class's `prototype`.
    Prototype(Sym),
    /// The `default` that `createDefaultPropertyWrapperForModule` creates for this module.
    SyntheticDefault(Sym),
    /// A symbol without declarations, identified by its name: `arguments`, `require`, a type name
    /// that doesn't resolve.
    Undeclared(Atom),
    /// A symbol that's equal only to itself.
    Unique(u32),
}

pub(super) struct Entry<'p> {
    pub(super) key: Key<'p>,
    /// The property it was found as, and the mapper to read it with.
    pub(super) prop: Option<(&'p Prop<'p>, MapperId)>,
    /// `symbol.name` where it differs from the key's name: for a late-bound member or a type name
    /// that doesn't resolve.
    pub(super) name: Atom,
    /// Cached results of `symbol_info` and `declarations`.
    info: Option<SymbolInfo<'p>>,
    declarations: Option<&'p [NodeRef]>,
}

/// `removeFileExtension`
fn remove_file_extension(path: &[u8]) -> &[u8] {
    const EXTENSIONS_TO_REMOVE: [&[u8]; 12] = [
        b".d.ts", b".d.mts", b".d.cts", b".mjs", b".mts", b".cjs", b".cts", b".ts", b".js",
        b".tsx", b".jsx", b".json",
    ];
    EXTENSIONS_TO_REMOVE
        .iter()
        .find_map(|extension| path.strip_suffix(*extension))
        .unwrap_or(path)
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
    pub(super) fn intern_symbol(
        &mut self,
        key: Key<'c>,
        prop: Option<(&'c Prop<'c>, MapperId)>,
    ) -> SymbolRef {
        if let Some(&id) = self.symbol_ids.get(&key) {
            if let Some(entry) = self.symbols.get_mut(id.0 as usize)
                && entry.prop.is_none()
            {
                entry.prop = prop;
                entry.info = None;
            }
            return id;
        }
        let id = SymbolRef(self.symbols.len() as u32);
        self.symbols.push(Entry {
            key,
            prop,
            name: Atom::NONE,
            info: None,
            declarations: None,
        });
        self.symbol_ids.insert(key, id);
        id
    }

    /// The ref for `symbol`, or for the symbol it's merged into.
    pub(super) fn symbol(&mut self, symbol: Sym) -> SymbolRef {
        let symbol = self.c.files().canonical(symbol);
        self.intern_symbol(Key::Symbol(symbol), None)
    }

    /// `intern_symbol`, then sets the symbol's name to `name`.
    pub(super) fn named_symbol(&mut self, key: Key<'c>, name: Atom) -> SymbolRef {
        let id = self.intern_symbol(key, None);
        if let Some(entry) = self.symbols.get_mut(id.0 as usize) {
            entry.name = name;
            entry.info = None;
        }
        id
    }

    pub(super) fn unique_symbol(&mut self) -> SymbolRef {
        let key = Key::Unique(self.symbols.len() as u32);
        self.intern_symbol(key, None)
    }

    /// The ref for property `prop`. `mapper` is the mapper it was found with.
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
            ref source => {
                let own = self.c.mapper_of_prop(prop);
                Key::Property(source, prop.name, self.c.compose(own, mapper))
            }
        };
        self.intern_symbol(key, Some((prop, mapper)))
    }

    #[inline]
    fn entry(&self, symbol: SymbolRef) -> Option<(Key<'c>, Option<(&'c Prop<'c>, MapperId)>)> {
        self.symbols
            .get(symbol.0 as usize)
            .map(|entry| (entry.key, entry.prop))
    }

    /// The binder symbol, if `symbol` is one.
    pub(super) fn sym_of(&self, symbol: SymbolRef) -> Option<Sym> {
        match self.entry(symbol)?.0 {
            Key::Symbol(symbol) | Key::Instantiated(symbol, _) => Some(symbol),
            _ => None,
        }
    }

    /// `symbol` as a property, synthesized from its declaration if it wasn't found as one.
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
            name_type: TypeId::UNRESOLVED,
        });
        if let Some(entry) = self.symbols.get_mut(symbol.0 as usize) {
            entry.prop = Some((prop, MapperId::IDENTITY));
            entry.info = None;
        }
        Some((prop, MapperId::IDENTITY))
    }

    /// `symbol.name`, spelled the way TypeScript spells it.
    fn typescript_symbol_name(&self, name: Atom) -> &'c [u8] {
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
                    _ if bytes.starts_with(crate::atom::PRIVATE_NAME_PREFIX) => {
                        crate::atom::written_name(bytes)
                    }
                    [0xFE, rest @ ..] => self.list(&cat!(b"__", rest)),
                    _ => bytes,
                };
            }
        };
        internal
    }

    // ───────────────────────────── fields ─────────────────────────────

    pub fn symbol_info(&mut self, symbol: SymbolRef) -> SymbolInfo<'c> {
        if let Some(known) = self
            .symbols
            .get(symbol.0 as usize)
            .and_then(|entry| entry.info)
        {
            return known;
        }
        let info = self.symbol_info_uncached(symbol);
        if let Some(entry) = self.symbols.get_mut(symbol.0 as usize) {
            entry.info = Some(info);
        }
        info
    }

    fn symbol_info_uncached(&mut self, symbol: SymbolRef) -> SymbolInfo<'c> {
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
                info.name = self.typescript_symbol_name(match prop {
                    // A late-bound member takes the property's name.
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
                let is_local = sym.file == self.file
                    && !flags.intersects(SymFlags::MERGED | SymFlags::TRANSIENT);
                info.local = (is_local && matches!(key, Key::Symbol(_))).then_some(sym.id);
                if prop.is_none() && self.is_optional_declaration(sym) {
                    info.flags |= SymbolFlags::OPTIONAL;
                }
                if info.name.is_empty() && flags.contains(SymFlags::CLASS) {
                    info.name = b"__class";
                }
                // A module that's a file or is named by a string has its name in quotes.
                if flags.intersects(SymFlags::MODULE) {
                    match files.decls_of(sym).first() {
                        Some(&(file, Decl::File)) => {
                            let path = files.module(file).file_name();
                            let path = remove_file_extension(path);
                            info.name = self.list(&cat!(b"\"", path, b"\""));
                        }
                        Some(&(file, Decl::Module(module)))
                            if matches!(self.c.hir(file)[module].name, ModuleName::String(_)) =>
                        {
                            info.name = self.list(&cat!(b"\"", info.name, b"\""));
                        }
                        _ => {}
                    }
                }
            }
            Key::Property(source, name, _) => {
                info.name = match name {
                    Atom::NONE => b"__computed",
                    name => self.typescript_symbol_name(name),
                };
                info.flags = SymbolFlags::PROPERTY;
                match source {
                    PropSource::Literal(file, p) => {
                        info.flags |= flags_of_literal_member(self.c.hir(*file)[*p].kind)
                            | SymbolFlags::TRANSIENT;
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
                    PropSource::Type(_) if name == known::prototype => {
                        info.flags |= SymbolFlags::PROTOTYPE
                    }
                    _ => info.flags |= SymbolFlags::TRANSIENT,
                }
            }
            Key::LiteralMember(file, p) => {
                let member = &self.c.hir(file)[p];
                info.flags = flags_of_literal_member(member.kind);
                info.name = match self.c.declared_member_name(file, member.key) {
                    Some(name) => self.typescript_symbol_name(name),
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
                    Kind::ObjectLiteralExpression | Kind::JsxAttributes => {
                        (&b"__object"[..], SymbolFlags::OBJECT_LITERAL)
                    }
                    Kind::ClassExpression => (&b"__class"[..], SymbolFlags::CLASS),
                    Kind::FunctionExpression | Kind::ArrowFunction => {
                        (&b"__function"[..], SymbolFlags::FUNCTION)
                    }
                    _ => (&b"__type"[..], SymbolFlags::TYPE_LITERAL),
                };
            }
            Key::Parameter(signature, index) => {
                info.flags = SymbolFlags::FUNCTION_SCOPED_VARIABLE;
                if let Some(parameter) = self.c.sig_params(signature).get(index as usize) {
                    info.name = match parameter.name {
                        // `bindParameter`'s name for a parameter whose name is a pattern.
                        Atom::NONE => self.list(format!("__{index}").as_bytes()),
                        name => self.typescript_symbol_name(name),
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
            Key::Undeclared(name) => info.name = self.typescript_symbol_name(name),
            Key::Unique(_) => {
                info.name = b"__index";
                info.flags = SymbolFlags::SIGNATURE | SymbolFlags::TRANSIENT;
            }
        }
        if let Some(name) = self
            .symbols
            .get(symbol.0 as usize)
            .map(|entry| entry.name)
            .filter(|name| name.is_some())
        {
            info.name = self.typescript_symbol_name(name);
            // `getUnresolvedSymbolForEntityName`
            if matches!(key, Key::Undeclared(_)) {
                info.flags = SymbolFlags::TYPE_ALIAS | SymbolFlags::TRANSIENT;
            }
        }
        if let Some((prop, _)) = prop {
            let is_declared = matches!(
                key,
                Key::Symbol(_) | Key::Instantiated(..) | Key::LiteralMember(..)
            ) || matches!(prop.source, PropSource::Literal(..));
            if !is_declared && prop.flags.contains(PropFlags::METHOD) {
                // `createUnionOrIntersectionProperty` creates a property symbol even when the parts
                // are methods.
                match info.check_flags.contains(CheckFlags::SYNTHETIC_PROPERTY) {
                    true => {
                        info.check_flags = (info.check_flags - CheckFlags::SYNTHETIC_PROPERTY)
                            | CheckFlags::SYNTHETIC_METHOD;
                    }
                    false => {
                        info.flags = (info.flags - SymbolFlags::PROPERTY) | SymbolFlags::METHOD
                    }
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
                    (
                        PropFlags::HAS_NON_UNIFORM_TYPE,
                        CheckFlags::HAS_NON_UNIFORM_TYPE,
                    ),
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

    /// True if the member or parameter property that declares `sym` has a `?`.
    fn is_optional_declaration(&mut self, sym: Sym) -> bool {
        match self.c.files().value_declaration(sym) {
            Some((file, Decl::Member(member))) => {
                self.c.hir(file)[member].flags.contains(Flags::OPTIONAL)
            }
            Some((file, Decl::ParameterProperty(parameter))) => {
                self.c.hir(file)[parameter].flags.contains(Flags::OPTIONAL)
            }
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

    fn push_declarations_of_prop(
        &mut self,
        prop: &Prop,
        depth: u32,
        out: &mut SmallVec<[NodeRef; 4]>,
    ) {
        if depth > 64 {
            return;
        }
        match &prop.source {
            PropSource::Literal(file, property) => {
                let declarations = self
                    .c
                    .declarations_of_member(*file, Decl::Property(*property));
                out.extend(declarations.iter().map(|&it| self.node_of_declaration(it)));
            }
            PropSource::Symbol(symbol) => self.push_declarations_of_sym(*symbol, out),
            // `propSet` deduplicates the symbols.
            PropSource::Intersected(_, parts) if parts.len() > MANY => {
                let mut seen = crate::util::FxHashSet::default();
                for part in parts.iter().filter(|&part| seen.insert(part)) {
                    self.push_declarations_of_prop(part, depth + 1, out);
                }
            }
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
        if let Some(known) = self
            .symbols
            .get(symbol.0 as usize)
            .and_then(|entry| entry.declarations)
        {
            return known;
        }
        let declarations = self.declarations_uncached(symbol);
        if let Some(entry) = self.symbols.get_mut(symbol.0 as usize) {
            entry.declarations = Some(declarations);
        }
        declarations
    }

    fn declarations_uncached(&mut self, symbol: SymbolRef) -> &'c [NodeRef] {
        let Some((key, prop)) = self.entry(symbol) else {
            return &[];
        };
        let mut out: SmallVec<[NodeRef; 4]> = SmallVec::new();
        match key {
            Key::Symbol(sym) | Key::Instantiated(sym, _) => {
                self.push_declarations_of_sym(sym, &mut out)
            }
            Key::Property(..) | Key::LiteralMember(..) => {
                if let Some((prop, _)) = prop {
                    self.push_declarations_of_prop(prop, 0, &mut out);
                }
            }
            Key::Index(_, (file, member)) => {
                out.push(self.node_of_declaration((file, Decl::Member(member))))
            }
            Key::ThisParameter(file, function) => {
                let hir = self.c.hir(file);
                out.push(NodeRef {
                    file,
                    node: hir.node(hir[function].this_param),
                });
            }
            Key::Anonymous(file, node) => out.push(NodeRef { file, node }),
            Key::Parameter(signature, index) => {
                if let Some((file, parameter)) = self
                    .c
                    .sig_params(signature)
                    .get(index as usize)
                    .and_then(|it| it.declaration)
                {
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
                let declaration = match self.c.files().flags(sym).intersects(SymFlags::CLASS_MEMBER)
                {
                    true => self.c.value_declaration_of_property(sym),
                    false => self.c.files().value_declaration(sym),
                };
                declaration.map(|it| self.node_of_declaration(it))
            }
            Key::Property(..) | Key::LiteralMember(..) => {
                let declaration = self.c.value_declaration_of_prop(prop?.0)?;
                Some(self.node_of_declaration(declaration))
            }
            Key::Index(..)
            | Key::Prototype(_)
            | Key::SyntheticDefault(_)
            | Key::Undeclared(_)
            | Key::Unique(_) => None,
            Key::ThisParameter(..) | Key::Anonymous(..) | Key::Parameter(..) => {
                self.declarations(symbol).first().copied()
            }
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
                // The signature stores `getTypeOfParameter`, which adds `undefined` for an
                // initializer. The variable's type doesn't include it.
                if let Some((file, declaration)) = parameter.declaration
                    && self.c.hir(file)[declaration].default.is_some()
                {
                    let origin = self.c.types().sig_origin(signature);
                    let mapper = self
                        .c
                        .sig_decl(origin)
                        .map_or(MapperId::IDENTITY, |it| it.2);
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
                infos
                    .iter()
                    .find(|it| it.declaration == Some(node))
                    .map_or(TypeId::ERROR, |it| it.ty)
            }
            Key::Property(..) | Key::LiteralMember(..) | Key::Undeclared(_) | Key::Unique(_) => {
                TypeId::ERROR
            }
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
            // A property access's name represents the whole access.
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
        let is_optional = self
            .symbol_info(symbol)
            .flags
            .contains(SymbolFlags::OPTIONAL);
        self.c.remove_missing_type(ty, is_optional)
    }

    // ───────────────────────────── other symbols ─────────────────────────────

    pub fn symbol_op(&mut self, op: SymbolOp, symbol: SymbolRef) -> Option<SymbolRef> {
        let (key, _) = self.entry(symbol)?;
        let files = self.c.files();
        match (op, key) {
            (SymbolOp::Merged, _) => Some(symbol),
            (SymbolOp::Aliased, Key::Symbol(sym)) => {
                if !files.flags(sym).contains(SymFlags::ALIAS) {
                    return None;
                }
                match self.c.resolve_alias(sym) {
                    AliasTarget::Symbol(target) => Some(self.symbol(target)),
                    AliasTarget::Property(owner, name, _) => {
                        match self.c.get_property_of_type(owner, name) {
                            Some((prop, mapper)) => Some(self.symbol_of_prop(prop, mapper)),
                            None => Some(self.symbol(files.unknown_symbol)),
                        }
                    }
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
            _ => None,
        }
    }

    pub fn symbol_table(&mut self, table: SymbolTable, symbol: SymbolRef) -> &'c [SymbolRef] {
        let Some(sym) = self.sym_of(symbol) else {
            return &[];
        };
        let files = self.c.files();
        let symbols: Vec<Sym> = match table {
            SymbolTable::ExportsOfModule => {
                files.exports_of_module(sym).iter().map(|it| it.1).collect()
            }
            SymbolTable::Members => files.members_in_table(sym).iter().map(|it| it.1).collect(),
        };
        let symbols: Vec<SymbolRef> = symbols.into_iter().map(|it| self.symbol(it)).collect();
        self.list(&symbols)
    }

    pub fn is_unknown_symbol(&mut self, symbol: SymbolRef) -> bool {
        self.sym_of(symbol) == Some(self.c.files().unknown_symbol)
    }

    // ───────────────────────────── members of types ─────────────────────────────

    pub fn properties_of_type(&mut self, ty: TypeId) -> &'c [SymbolRef] {
        if let Some(&known) = self.properties.get(&ty) {
            return known;
        }
        let properties = self.properties_of_type_uncached(ty);
        self.properties.insert(ty, properties);
        properties
    }

    fn properties_of_type_uncached(&mut self, ty: TypeId) -> &'c [SymbolRef] {
        let ty = self.c.reduced_apparent_type_as_object(ty);
        let Some(members) = self.c.members(ty) else {
            return &[];
        };
        let shape: &'p Listed<'p> = members.shape();
        let mut symbols = Vec::with_capacity(shape.props.len());
        for prop in shape.props.iter() {
            symbols.push(self.symbol_of_prop(prop, members.mapper));
        }
        self.list(&symbols)
    }

    pub fn property_of_type(&mut self, ty: TypeId, name: &[u8]) -> Option<SymbolRef> {
        let name = self.property_name(name);
        let (prop, mapper) = self.c.get_property_of_type(ty, name)?;
        Some(self.symbol_of_prop(prop, mapper))
    }

    /// The atom for a property name. `__@iterator` is the name of the property whose key is
    /// `Symbol.iterator`. The name is interned, not looked up, because a late-bound member's name
    /// doesn't exist as an atom until its type's members are resolved.
    fn property_name(&self, name: &[u8]) -> Atom {
        match name.strip_prefix(b"__@") {
            Some(symbol) => self.c.atoms().symbol_name(symbol),
            None => self.c.atoms().intern(name),
        }
    }

    pub fn type_of_property_of_type(&mut self, ty: TypeId, name: &[u8]) -> Option<TypeId> {
        let name = self.property_name(name);
        self.c.type_of_property_of_type(ty, name)
    }

    // ───────────────────────────── signatures ─────────────────────────────

    pub fn signature_info(&mut self, signature: SigId) -> SignatureInfo<'c> {
        if let Some(&known) = self.signatures.get(&signature) {
            return known;
        }
        let info = self.signature_info_uncached(signature);
        self.signatures.insert(signature, info);
        info
    }

    fn signature_info_uncached(&mut self, signature: SigId) -> SignatureInfo<'c> {
        let parameters = self.c.sig_params(signature);
        let symbols: SmallVec<[SymbolRef; 4]> = (0..parameters.len() as u32)
            .map(|index| self.intern_symbol(Key::Parameter(signature, index), None))
            .collect();
        let type_parameters = self.c.sig_type_params(signature);
        // `getDefaultConstructSignatures` clones the signature of the base class.
        let origin = self
            .c
            .default_construct_base_sig(signature)
            .unwrap_or(signature);
        let origin = self.c.types().sig_origin(origin);
        let declaration = self.c.sig_decl(origin).map(|(file, function, _)| NodeRef {
            file,
            node: self.c.hir(file).node(function),
        });
        let this_parameter = self
            .c
            .sig_this_parameter(signature)
            .and_then(|(_, declaring)| {
                let origin = self.c.types().sig_origin(declaring);
                let (file, function, _) = self.c.sig_decl(origin)?;
                Some(self.intern_symbol(Key::ThisParameter(file, function), None))
            });
        SignatureInfo {
            parameters: self.list(&symbols),
            type_parameters: self.list(&type_parameters),
            this_parameter,
            declaration,
        }
    }

    pub fn return_type_of_signature(&mut self, signature: SigId) -> TypeId {
        self.c.sig_return(signature)
    }

    pub fn type_predicate_of_signature(
        &mut self,
        signature: SigId,
    ) -> Option<TypePredicateData<'p>> {
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

    pub fn signature_to_string(&mut self, signature: SigId) -> Vec<u8> {
        let mut out = Vec::new();
        self.c.write_signature(&mut out, signature);
        out
    }
}
