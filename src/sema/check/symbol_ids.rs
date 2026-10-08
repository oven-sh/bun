//! `ast.GetSymbolId`.
//!
//! typescript-go numbers a symbol when its id is first asked for: by the binder for the class of an
//! `#x`, by the checker for the keys of some caches (`keyBuilder.writeSymbol`, `enumRelation`), by
//! the node builder for the symbols it prints. The id of the symbol of a `unique symbol` is part of
//! the name of the property it names (`getESSymbolLikeTypeForNode`). A few messages print that name,
//! and its length counts where a printed type is truncated. So the ids are observable, and each
//! depends on everything that was checked before.
//!
//! Only a checker that checks the files of the program in program order can hand them out
//! (`Checker::hand_out_symbol_ids`). Every other checker names such a property by the place of the
//! declaration.

use super::*;
use crate::bind::{Decl, FnOwner};
use std::borrow::Cow;

/// How many digits an id is assumed to have where none is handed out.
const ASSUMED_DIGITS: usize = 4;

/// A symbol, as `GetSymbolId` tells symbols apart.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum SymbolKey {
    /// `symbol.Declarations[0]`
    Declared(FileId, Decl),
    /// It has no declaration.
    Undeclared(Sym),
    /// A transient symbol: the hash of what identifies it.
    Transient(u64),
}

#[derive(Default)]
pub(super) struct SymbolIds {
    /// `symbol.id`. `nextSymbolId` is their number.
    ids: FxHashMap<SymbolKey, u32>,
    /// The id of the symbol of a `unique symbol`, by the name that `property_name_of_type` gives
    /// the property it names.
    of_late_bound_names: FxHashMap<Atom, u32>,
    /// `Emit` follows the check of the last file, so what it is the first to ask about gets an id
    /// that nothing reads.
    is_emitting: bool,
}

impl SymbolIds {
    /// `GetSymbolId`
    fn get(&mut self, key: SymbolKey) -> Option<u32> {
        if self.is_emitting {
            return self.ids.get(&key).copied();
        }
        let next = self.ids.len() as u32 + 1;
        Some(*self.ids.entry(key).or_insert(next))
    }
}

impl Checker<'_, '_> {
    /// From now on this checker hands out symbol ids. It is the only checker of the program, and
    /// has not checked anything yet.
    pub fn hand_out_symbol_ids(&mut self) {
        let mut handed_out = SymbolIds::default();
        // `BindSourceFiles`: a `singleThreadedWorkGroup` runs what was queued last first.
        for &file in self.files().order.iter().rev() {
            for &class in self.bound(file).classes_of_private_names.iter() {
                handed_out.get(self.key_of_symbol(self.class_sym(file, class)));
            }
        }
        self.symbol_ids = Some(std::cell::RefCell::new(handed_out));
    }

    #[inline]
    pub(super) fn hands_out_symbol_ids(&self) -> bool {
        self.symbol_ids.is_some()
    }

    /// Returns what it was. See `SymbolIds::is_emitting`.
    pub(super) fn set_symbol_ids_emitting(&self, is_emitting: bool) -> bool {
        match &self.symbol_ids {
            Some(handed_out) => {
                std::mem::replace(&mut handed_out.borrow_mut().is_emitting, is_emitting)
            }
            None => false,
        }
    }

    fn key_of_symbol(&self, symbol: Sym) -> SymbolKey {
        match self.files().decls_of(symbol).first() {
            Some(&(file, first)) => SymbolKey::Declared(file, first),
            None => SymbolKey::Undeclared(symbol),
        }
    }

    /// `getSymbolOfDeclaration(declaration)`
    fn key_of_declaration(&self, file: FileId, declaration: Decl) -> SymbolKey {
        let symbol = self.bound(file).symbol_of_declaration(declaration);
        if symbol.is_none() {
            return SymbolKey::Declared(file, declaration);
        }
        self.key_of_symbol(self.files().sym(file, symbol))
    }

    #[cold]
    fn get_symbol_id_of_key(&self, key: SymbolKey) -> Option<u32> {
        self.symbol_ids.as_ref()?.borrow_mut().get(key)
    }

    /// `GetSymbolId(symbol)`, here and below for what it does to the ids handed out later.
    #[inline]
    pub(super) fn get_symbol_id(&self, symbol: Sym) {
        if self.symbol_ids.is_some() {
            self.get_symbol_id_of_key(self.key_of_symbol(symbol));
        }
    }

    /// .. of the symbol of the variable, parameter, member or property that `declaration` declares.
    pub(super) fn get_symbol_id_of_node(&self, file: FileId, declaration: hir::Node) {
        if self.symbol_ids.is_none() {
            return;
        }
        let hir = self.hir(file);
        let declaration = match hir.data(declaration) {
            NodeData::VarDecl(variable) => Decl::Var(hir[variable].pat),
            NodeData::Param(parameter) => Decl::Param(hir[parameter].pat),
            NodeData::Member(member) => Decl::Member(member),
            NodeData::Prop(property) => Decl::Property(property),
            _ => return,
        };
        self.get_symbol_id_of_key(self.key_of_declaration(file, declaration));
    }

    /// .. of the symbol of the function, method, accessor or signature `function`, which for a
    /// function type is the `__type` of its node.
    pub(super) fn get_symbol_id_of_function(&self, file: FileId, function: FnId) {
        if self.symbol_ids.is_none() {
            return;
        }
        let declaration = match self.bound(file).fns[function.idx()].owner {
            FnOwner::Member(member) => Decl::Member(member),
            FnOwner::Type(node) => Decl::TypeLiteral(node),
            FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) => Decl::Fn(function),
        };
        self.get_symbol_id_of_key(self.key_of_declaration(file, declaration));
    }

    /// .. of `t.symbol` for the anonymous object type of `origin`.
    pub(super) fn get_symbol_id_of_origin(&self, origin: Origin) {
        if self.symbol_ids.is_none() {
            return;
        }
        let key = match origin {
            Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => {
                SymbolKey::Declared(file, Decl::TypeLiteral(node))
            }
            Origin::ObjectLiteral(file, literal, ..)
            | Origin::WidenedLiteral(file, literal, ..) => {
                SymbolKey::Declared(file, Decl::ObjectLiteral(literal))
            }
            Origin::ClassStatic(symbol)
            | Origin::Function(symbol)
            | Origin::EnumObject(symbol)
            | Origin::Module(symbol) => self.key_of_symbol(symbol),
            Origin::Namespace { .. } => SymbolKey::Transient(crate::util::fx_hash(&origin)),
            Origin::GlobalThis => self.key_of_symbol(self.files().global_this_symbol),
        };
        self.get_symbol_id_of_key(key);
    }

    /// .. of `typeParameter.symbol`.
    pub(super) fn get_symbol_id_of_type_parameter(&self, parameter: TypeId) {
        if self.symbol_ids.is_none() {
            return;
        }
        let key = match *self.data(parameter) {
            TypeData::TypeParam(file, declared, _) if !self.is_renamed_type_param(parameter) => {
                self.key_of_declaration(file, Decl::TypeParam(declared))
            }
            _ => SymbolKey::Transient(crate::util::fx_hash(&parameter)),
        };
        self.get_symbol_id_of_key(key);
    }

    /// .. of a property. One that is instantiated, or created from others, is a symbol of its own.
    pub(super) fn get_symbol_id_of_property(&mut self, prop: &Prop) {
        if self.symbol_ids.is_none() {
            return;
        }
        let key = match prop.source {
            PropSource::Symbol(symbol) if prop.mapper == MapperId::IDENTITY => {
                self.key_of_symbol(symbol)
            }
            PropSource::Literal(file, written) if prop.mapper == MapperId::IDENTITY => {
                let first = self.first_declaration_of_literal_member(file, written);
                self.key_of_declaration(file, Decl::Property(first))
            }
            _ => SymbolKey::Transient(crate::util::fx_hash(prop)),
        };
        self.get_symbol_id_of_key(key);
    }

    /// `newUniqueESSymbolType(symbol, name)` in `getESSymbolLikeTypeForNode`, which puts the id of
    /// the symbol into the name.
    pub(super) fn new_unique_es_symbol_type(
        &mut self,
        symbol: UniqueSymbolDeclaration,
        name: Atom,
    ) -> TypeId {
        let unique_type = self.intern(TypeData::UniqueSymbol { symbol, name });
        if self.symbol_ids.is_some() {
            let key = match (self.symbol_of_unique_symbol(symbol, name), symbol) {
                (Some(declared), _) => Some(self.key_of_symbol(declared)),
                (None, UniqueSymbolDeclaration::Member(file, member)) => {
                    Some(SymbolKey::Declared(file, Decl::Member(member)))
                }
                (None, _) => None,
            };
            if let Some(id) = key.and_then(|key| self.get_symbol_id_of_key(key))
                && let Some(property_name) = self.property_name_of_type(unique_type)
                && let Some(handed_out) = &self.symbol_ids
            {
                let mut handed_out = handed_out.borrow_mut();
                handed_out.of_late_bound_names.insert(property_name, id);
            }
        }
        unique_type
    }

    /// `getPropertyNameForKnownSymbolName(symbolName)` asks for the type of `Symbol[symbolName]`.
    /// Here the name of the property it names is a constant.
    pub(super) fn resolve_known_symbol(&mut self, symbol_name: &[u8]) {
        if self.symbol_ids.is_some() {
            let name = self.atoms().intern(symbol_name);
            self.new_unique_es_symbol_type(UniqueSymbolDeclaration::SymbolConstructor, name);
        }
    }

    /// `name` without the id, if a `unique symbol` names the property: `\xFE@description`.
    fn described(&self, name: Atom) -> Option<&[u8]> {
        if !self.atoms().is_symbol_name(name) {
            return None;
        }
        let text = self.atoms().bytes(name);
        Some(match bun_core::strings::last_index_of_char(text, b'@') {
            Some(at) if at >= crate::atom::SYMBOL_NAME_PREFIX.len() => &text[..at],
            // Here the name of `[Symbol.iterator]` has no id.
            _ => text,
        })
    }

    fn id_in_late_bound_name(&self, name: Atom) -> Option<u32> {
        let handed_out = self.symbol_ids.as_ref()?.borrow();
        handed_out.of_late_bound_names.get(&name).copied()
    }

    /// `symbol.Name`, as text that is printed or compared. The name of a property that a `unique
    /// symbol` names ends with the id of the symbol.
    pub(super) fn symbol_name_with_id(&self, name: Atom) -> Cow<'_, [u8]> {
        let Some(described) = self.described(name) else {
            return Cow::Borrowed(self.atoms().bytes(name));
        };
        match self.id_in_late_bound_name(name) {
            Some(id) => {
                let mut digits = bun_core::fmt::ItoaBuf::new();
                let digits = bun_core::fmt::itoa(&mut digits, id);
                Cow::Owned(cat!(described, b"@", digits))
            }
            None => Cow::Borrowed(self.atoms().bytes(name)),
        }
    }

    /// `len(symbol.Name)` for a property that a `unique symbol` names.
    pub(super) fn length_of_late_bound_name(&self, name: Atom) -> Option<usize> {
        let described = self.described(name)?.len() + 1;
        Some(match self.id_in_late_bound_name(name) {
            Some(id) => described + id.ilog10() as usize + 1,
            None => described + ASSUMED_DIGITS,
        })
    }
}
