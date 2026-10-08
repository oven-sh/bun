//! `ts.Symbol`

use super::{CheckFlags, Locate, ModifierFlags, SymbolFlags, TsNode, Type};
use crate::ast::File;
use bun_sema::check::services::{SymbolOp, SymbolRef, SymbolTable};

/// `ts.Symbol`: anything that is declared anywhere in the program, or that the checker makes up as
/// if it were: a variable, a class, a module, a property of a type, a parameter of a signature.
///
/// Two are `==` where TypeScript has one object.
#[derive(Copy, Clone)]
pub struct TsSymbol<'a> {
    file: &'a File<'a>,
    id: SymbolRef,
}

impl PartialEq for TsSymbol<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for TsSymbol<'_> {}
impl std::hash::Hash for TsSymbol<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}
impl std::fmt::Debug for TsSymbol<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TsSymbol({})", bstr::BStr::new(self.name()))
    }
}

/// A list of symbols: the properties of a type, the exports of a module.
#[derive(Copy, Clone)]
pub struct SymbolList<'a> {
    file: &'a File<'a>,
    ids: &'a [SymbolRef],
}

impl<'a> SymbolList<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, ids: &'a [SymbolRef]) -> Self {
        SymbolList { file, ids }
    }

    #[inline]
    pub fn len(self) -> usize {
        self.ids.len()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.ids.is_empty()
    }

    #[inline]
    pub fn get(self, i: usize) -> Option<TsSymbol<'a>> {
        self.ids.get(i).map(|&id| TsSymbol::new(self.file, id))
    }

    #[inline]
    pub fn first(self) -> Option<TsSymbol<'a>> {
        self.get(0)
    }

    #[inline]
    pub fn last(self) -> Option<TsSymbol<'a>> {
        self.ids.last().map(|&id| TsSymbol::new(self.file, id))
    }

    pub fn iter(
        self,
    ) -> impl DoubleEndedIterator<Item = TsSymbol<'a>> + ExactSizeIterator + Clone + 'a {
        let file = self.file;
        self.ids.iter().map(move |&id| TsSymbol::new(file, id))
    }
}

impl std::fmt::Debug for SymbolList<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

impl<'a> IntoIterator for SymbolList<'a> {
    type Item = TsSymbol<'a>;
    type IntoIter = SymbolIter<'a>;
    #[inline]
    fn into_iter(self) -> SymbolIter<'a> {
        SymbolIter {
            file: self.file,
            ids: self.ids.iter(),
        }
    }
}

#[derive(Clone)]
pub struct SymbolIter<'a> {
    file: &'a File<'a>,
    ids: std::slice::Iter<'a, SymbolRef>,
}

impl<'a> Iterator for SymbolIter<'a> {
    type Item = TsSymbol<'a>;
    #[inline]
    fn next(&mut self) -> Option<TsSymbol<'a>> {
        self.ids.next().map(|&id| TsSymbol::new(self.file, id))
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.ids.size_hint()
    }
}
impl ExactSizeIterator for SymbolIter<'_> {}

impl<'a> TsSymbol<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: SymbolRef) -> Self {
        TsSymbol { file, id }
    }

    #[inline]
    fn op(self, op: SymbolOp) -> Option<TsSymbol<'a>> {
        let id = self.file.query(|q| q.symbol_op(op, self.id))?;
        Some(TsSymbol::new(self.file, id))
    }

    #[inline]
    fn table(self, table: SymbolTable) -> SymbolList<'a> {
        SymbolList::new(
            self.file,
            self.file.query(|q| q.symbol_table(table, self.id)),
        )
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    // ───────────────────────────── fields ─────────────────────────────

    /// `symbol.name`, `symbol.getName()`, `symbol.escapedName`, `symbol.getEscapedName()`
    ///
    /// They differ in TypeScript only for a name in the source that begins with `__`, which
    /// `escapedName` gives one more `_`. This is `name`. A name that the compiler makes up is
    /// spelled as there: `__type`, `__object`, `__function`, `__call`, `__index`, `default`,
    /// `export=`. That of a property whose key is a well-known symbol is `__@iterator`, without
    /// the number that follows in TypeScript.
    pub fn name(self) -> &'a [u8] {
        self.file.query(|q| q.symbol_info(self.id)).name
    }

    /// `symbol.escapedName`
    #[inline]
    pub fn escaped_name(self) -> &'a [u8] {
        self.name()
    }

    /// `symbol.flags`, `symbol.getFlags()`
    pub fn flags(self) -> SymbolFlags {
        self.file.query(|q| q.symbol_info(self.id)).flags
    }

    /// `tsutils.isSymbolFlagSet(symbol, flags)`
    #[inline]
    pub fn has_flags(self, flags: SymbolFlags) -> bool {
        self.flags().intersects(flags)
    }

    /// `symbol.links.checkFlags`, `getCheckFlags(symbol)`
    pub fn check_flags(self) -> CheckFlags {
        self.file.query(|q| q.symbol_info(self.id)).check_flags
    }

    /// `symbol.declarations`, `symbol.getDeclarations()`. Empty where TypeScript has `undefined`.
    pub fn declarations(
        self,
    ) -> impl DoubleEndedIterator<Item = TsNode<'a>> + ExactSizeIterator + Clone + 'a {
        let file = self.file;
        let declarations = file.query(|q| q.declarations(self.id));
        declarations.iter().map(move |&node| TsNode::of(file, node))
    }

    /// `symbol.getDeclarations()`
    #[inline]
    pub fn get_declarations(
        self,
    ) -> impl DoubleEndedIterator<Item = TsNode<'a>> + ExactSizeIterator + Clone + 'a {
        self.declarations()
    }

    /// `symbol.valueDeclaration`
    pub fn value_declaration(self) -> Option<TsNode<'a>> {
        let node = self.file.query(|q| q.value_declaration(self.id))?;
        Some(TsNode::of(self.file, node))
    }

    /// `symbol.parent`
    pub fn parent(self) -> Option<TsSymbol<'a>> {
        self.op(SymbolOp::Parent)
    }

    /// `symbol.members`: of a class, an interface or a type literal.
    pub fn members(self) -> SymbolList<'a> {
        self.table(SymbolTable::Members)
    }

    /// `symbol.exports`: of a module, a namespace or an enum, and the static members of a class.
    pub fn exports(self) -> SymbolList<'a> {
        self.table(SymbolTable::Exports)
    }

    /// The symbol of the file that is linted which this is, if it is declared there in a scope and
    /// nowhere else.
    pub fn local(self) -> Option<crate::semantic::Symbol<'a>> {
        let local = self.file.query(|q| q.symbol_info(self.id)).local?;
        crate::semantic::Symbol::some(self.file, local)
    }

    // ───────────────────────────── ts.TypeChecker ─────────────────────────────

    /// `checker.getTypeOfSymbol(symbol)`
    pub fn get_type(self) -> Type<'a> {
        Type::new(self.file, self.file.query(|q| q.type_of_symbol(self.id)))
    }

    /// `checker.getTypeOfSymbolAtLocation(symbol, node)`
    pub fn get_type_at_location(self, node: impl Locate<'a>) -> Type<'a> {
        let node = node.locate(self.file).raw();
        Type::new(
            self.file,
            self.file
                .query(|q| q.type_of_symbol_at_location(self.id, node)),
        )
    }

    /// `checker.getDeclaredTypeOfSymbol(symbol)`: the type that a class, an interface, an enum, a
    /// type alias or a type parameter names.
    pub fn get_declared_type(self) -> Type<'a> {
        Type::new(
            self.file,
            self.file.query(|q| q.declared_type_of_symbol(self.id)),
        )
    }

    /// `checker.getAliasedSymbol(symbol)`: what an import or an export finally refers to. The
    /// unknown symbol if that cannot be resolved ([`TsSymbol::is_unknown`]). TypeScript fails for a
    /// symbol that is not an alias, this returns it.
    pub fn get_aliased_symbol(self) -> TsSymbol<'a> {
        self.op(SymbolOp::Aliased).unwrap_or(self)
    }

    /// `checker.getImmediateAliasedSymbol(symbol)`: one step of that.
    pub fn get_immediate_aliased_symbol(self) -> Option<TsSymbol<'a>> {
        self.op(SymbolOp::ImmediateAliased)
    }

    /// `skipAlias(symbol, checker)`
    pub fn skip_alias(self) -> TsSymbol<'a> {
        match self.has_flags(SymbolFlags::ALIAS) {
            true => self.get_aliased_symbol(),
            false => self,
        }
    }

    /// `checker.getExportSymbolOfSymbol(symbol)`
    pub fn get_export_symbol(self) -> TsSymbol<'a> {
        self.op(SymbolOp::ExportSymbol).unwrap_or(self)
    }

    /// `checker.getMergedSymbol(symbol)`
    pub fn get_merged_symbol(self) -> TsSymbol<'a> {
        self.op(SymbolOp::Merged).unwrap_or(self)
    }

    /// `checker.getExportsOfModule(symbol)`: with what `export *` adds.
    pub fn get_exports_of_module(self) -> SymbolList<'a> {
        self.table(SymbolTable::ExportsOfModule)
    }

    /// `checker.isUnknownSymbol(symbol)`
    pub fn is_unknown(self) -> bool {
        self.file.query(|q| q.is_unknown_symbol(self.id))
    }

    /// `isReadonlySymbol(symbol)`
    pub fn is_readonly(self) -> bool {
        self.file.query(|q| q.is_readonly_symbol(self.id))
    }

    /// `isSpreadableProperty(symbol)`
    pub fn is_spreadable_property(self) -> bool {
        self.file.query(|q| q.is_spreadable_property(self.id))
    }

    /// `getDeclarationModifierFlagsFromSymbol(symbol)`
    pub fn get_declaration_modifier_flags(self) -> ModifierFlags {
        self.file
            .query(|q| q.declaration_modifier_flags_from_symbol(self.id))
    }

    /// `symbol.getJsDocTags(checker).find(tag => tag.name === 'deprecated')`, as
    /// `ts.displayPartsToString(tag.text)`: empty if nothing follows the tag. The tags are those of
    /// all its declarations, or those that a member without any inherits.
    pub fn deprecation(self) -> Option<&'a [u8]> {
        self.file.query(|q| q.deprecation_of_symbol(self.id))
    }

    /// `checker.symbolToString(symbol)`
    pub fn to_text(self) -> Vec<u8> {
        self.file.query(|q| q.symbol_to_string(self.id))
    }
}
