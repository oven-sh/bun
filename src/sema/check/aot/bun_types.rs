use crate::atom::Atom;
use crate::bind::Decl;
use crate::check::Checker;
use crate::hir::ExprId;
use crate::hir::{TypeNodeId, TypeNodeKind};
use crate::program::{FileId, Sym};
use crate::types::{Origin, TypeData, TypeId};

impl<'p, 's> Checker<'p, 's> {
    pub fn declares_bun_module(&self, file: FileId) -> bool {
        self.files().bun_intrinsics == Some(file)
    }

    pub fn bun_intrinsic(&self, sym: Sym) -> Option<Atom> {
        self.declares_bun_module(sym.file)
            .then(|| self.files().symbol(sym).name)
    }

    pub fn sql_query_row_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let query = self.type_of_expr(file, e);
        let TypeData::Ref { target, .. } = *self.data(query) else {
            return None;
        };
        let whole = self.files().canonical(target);
        let namespace = self.files().parent_of_symbol(whole)?;
        let module = self.files().parent_of_symbol(namespace)?;
        let has_name =
            |sym: Sym, name: &[u8]| self.atoms().bytes(self.files().symbol(sym).name) == name;
        if !has_name(whole, b"Query")
            || !has_name(namespace, b"SQL")
            || !self
                .files()
                .decls(module)
                .iter()
                .any(|declaration| self.declares_bun_module(declaration.0))
        {
            return None;
        }
        let rows = *self.type_arguments(query).first()?;
        self.array_element(rows)
    }

    pub fn is_safe_validate_result_type(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Anon { origin: Origin::TypeLiteral(file, literal), .. } if self.is_safe_validate_result(*file, *literal))
    }

    pub fn is_safe_validate_result(&self, file: FileId, literal: TypeNodeId) -> bool {
        let Some(embedded) = self
            .files()
            .bun_intrinsics
            .filter(|_| self.is_declaration_only(file))
        else {
            return false;
        };
        let declared = self.hir(embedded).fns.iter().position(|function| {
            function.name.is_some() && self.atoms().bytes(function.name) == b"safeValidate"
        });
        let Some(id) = declared
            .map(|func| self.bound(embedded).fn_symbol[func])
            .filter(|id| !id.is_none())
        else {
            return false;
        };
        let whole = self.files().canonical(Sym { file: embedded, id });
        let hir = self.hir(file);
        self.files().decls(whole).iter().any(|&(declared_in, declaration)| {
            declared_in == file && matches!(declaration, Decl::Fn(func) if matches!(hir[hir[func].ret].kind, TypeNodeKind::Union(members) if hir.ids(members).any(|member| member == literal)))
        })
    }
}
