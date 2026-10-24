use super::{
    ExportId, ExprId, ExprKind, FileIn, Flags, ImportId, PropKey, PropKind, StmtId, StmtKind,
    Storage, mention_bit, rare,
};
use crate::atom::Atom;

impl<S: Storage> FileIn<S> {
    pub fn statement_import_attributes(&self, stmt: StmtId) -> ExprId {
        match self.stmts.get(stmt.idx()).map(|statement| statement.kind) {
            Some(StmtKind::Import(import)) => self[import].attributes,
            Some(StmtKind::ExportNamed(export)) => self[export].attributes,
            Some(StmtKind::ExportStar { .. }) => {
                let attributes = &self.export_star_attributes;
                let found = attributes.binary_search_by_key(&stmt, |of| of.0);
                found.map_or(ExprId::NONE, |at| attributes[at].1)
            }
            _ => ExprId::NONE,
        }
    }

    pub fn import_attribute(&self, attributes: ExprId, key: Atom) -> Option<Atom> {
        let ExprKind::Object(props) = self.exprs.get(attributes.idx())?.kind else {
            return None;
        };
        let mut all = props.iter().map(|prop| &self[prop]);
        let prop =
            all.find(|prop| prop.kind == PropKind::Init && prop.key == PropKey::Name(key))?;
        match self.exprs.get(prop.value.idx())?.kind {
            ExprKind::String(text) => Some(text),
            _ => None,
        }
    }

    pub fn may_mention(&self, text: &[u8]) -> bool {
        let bit = mention_bit(text);
        self.mentioned
            .get(bit as usize / 64)
            .is_none_or(|word| word >> (bit % 64) & 1 != 0)
    }

    #[inline]
    pub fn has_top_level_await(&self) -> bool {
        self.rare_syntax & rare::TOP_LEVEL_AWAIT != 0
    }

    pub fn is_export_declaration(&self, stmt: StmtId) -> bool {
        let Some(statement) = self.stmts.get(stmt.idx()) else {
            return false;
        };
        let flags = match statement.kind {
            StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAsNamespace(_) => return true,
            StmtKind::Var(_) => self.modifiers_to_flags(self.stmt_modifiers(stmt)),
            StmtKind::Fn(x) => self[x].flags,
            StmtKind::Class(x) => self[x].flags,
            StmtKind::Interface(x) => self[x].flags,
            StmtKind::TypeAlias(x) => self[x].flags,
            StmtKind::Enum(x) => self[x].flags,
            StmtKind::Module(x) => self[x].flags,
            StmtKind::ImportEquals(x) => self[x].flags,
            _ => Flags::empty(),
        };
        flags.contains(Flags::EXPORT)
    }

    pub fn is_type_only_import(&self, import: ImportId) -> bool {
        let import = &self[import];
        import.type_only
            || import.default.is_none()
                && import.namespace.is_none()
                && !import.named.is_empty()
                && import.named.iter().all(|spec| self[spec].type_only)
    }

    pub fn is_type_only_export(&self, export: ExportId) -> bool {
        let export = &self[export];
        export.type_only
            || !export.items.is_empty() && export.items.iter().all(|spec| self[spec].type_only)
    }
}
