use super::answers::{CheckedType, ClassRef, FunctionRef, GaveUp, MemberName};
use super::queries::Queries;
use super::type_shape::ShapeKind;
use crate::bind::{Decl, SymbolId};
use crate::hir::{self, FnId, has_body};
use crate::program::Sym;
use crate::types::{PropFlags, SigId, TypeId};
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct MemberPresence {
    pub name: MemberName,
    pub is_optional: bool,
}

fn function_of_declaration(hir: &hir::File<'_>, declaration: Decl) -> Option<FnId> {
    match declaration {
        Decl::Fn(function) => Some(function),
        Decl::Member(member) => hir[member].func.some(),
        _ => None,
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub fn signature_declaration(&self, signature: SigId) -> Option<FunctionRef> {
        let (file, function, _) = self.c.sig_decl(signature)?;
        Some(FunctionRef { file, function })
    }

    fn symbol_of_function(&self, function: FunctionRef) -> Option<Sym> {
        let (hir, bound) = (self.c.hir(function.file), self.c.bound(function.file));
        let symbol = bound.symbol_of_function(hir, function.function).some()?;
        Some(self.files().sym(function.file, symbol))
    }

    pub fn first_overload(&self, signatures: &[SigId]) -> Option<FunctionRef> {
        let (&first, others) = signatures.split_first()?;
        let first = self.signature_declaration(first)?;
        let symbol = self.symbol_of_function(first)?;
        let has_one_symbol = others.iter().all(|&other| {
            let other = self.signature_declaration(other);
            other.and_then(|other| self.symbol_of_function(other)) == Some(symbol)
        });
        has_one_symbol.then_some(first)
    }

    pub fn declaration_of_signatures(&self, signatures: &[SigId]) -> Option<FunctionRef> {
        match signatures {
            &[signature] => self.signature_declaration(signature),
            overloads => self.first_overload(overloads),
        }
    }

    pub(super) fn are_functions_of_one_declaration(&mut self, one: TypeId, other: TypeId) -> bool {
        let (Ok(one), Ok(other)) = (self.type_shape(one), self.type_shape(other)) else {
            return false;
        };
        let (ShapeKind::Function(one), ShapeKind::Function(other)) = (one.kind, other.kind) else {
            return false;
        };
        let declaration = self.declaration_of_signatures(one);
        declaration.is_some() && declaration == self.declaration_of_signatures(other)
    }

    pub fn overload_implementation(&self, overload: FunctionRef) -> Option<FunctionRef> {
        if has_body(&self.c.hir(overload.file)[overload.function]) {
            return None;
        }
        let symbol = self.symbol_of_function(overload)?;
        let declarations = self.files().decls_of(symbol);
        let mut implementations = declarations.iter().filter_map(|&(file, declaration)| {
            let hir = self.c.hir(file);
            let function = function_of_declaration(hir, declaration)?;
            has_body(&hir[function]).then_some(FunctionRef { file, function })
        });
        let implementation = implementations.next()?;
        implementations.next().is_none().then_some(implementation)
    }

    pub fn declared_class_type(&mut self, class: ClassRef) -> CheckedType {
        self.ask(|queries| {
            let symbol = queries.c.bound(class.file).class_symbol[class.class.idx()];
            if symbol == SymbolId::NONE {
                return Err(GaveUp::Unresolved);
            }
            let symbol = queries.files().sym(class.file, symbol);
            let ty = queries.c.declared_type(symbol);
            queries.resolved(ty)
        })
    }

    pub fn base_types_of_class(
        &mut self,
        class: ClassRef,
    ) -> Result<SmallVec<[TypeId; 1]>, GaveUp> {
        self.ask(|queries| {
            let symbol = queries.c.bound(class.file).class_symbol[class.class.idx()];
            if symbol == SymbolId::NONE {
                return Err(GaveUp::Unresolved);
            }
            let symbol = queries.files().sym(class.file, symbol);
            let bases: SmallVec<[TypeId; 1]> =
                queries.c.base_types(symbol).iter().copied().collect();
            bases
                .into_iter()
                .map(|base| queries.resolved(base))
                .collect()
        })
    }

    pub fn declared_base_types(&mut self, interface: Sym) -> Result<SmallVec<[TypeId; 1]>, GaveUp> {
        self.ask(|queries| {
            let bases: SmallVec<[TypeId; 1]> =
                queries.c.base_types(interface).iter().copied().collect();
            bases
                .into_iter()
                .map(|base| queries.resolved(base))
                .collect()
        })
    }

    pub fn member_presence(&mut self, object_type: TypeId) -> Result<&'c [MemberPresence], GaveUp> {
        self.ask(|queries| {
            let ty = queries.declared_type_of_this(object_type);
            let ty = queries.resolved(ty)?;
            let Some(members) = queries.c.members(ty) else {
                return Ok(&[][..]);
            };
            let props = members.shape().props.iter();
            let list: Vec<MemberPresence> = props
                .map(|prop| MemberPresence {
                    name: queries.member_name(prop.name),
                    is_optional: prop.flags.contains(PropFlags::OPTIONAL),
                })
                .collect();
            Ok(queries.list(&list))
        })
    }
}
