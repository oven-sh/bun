use super::Checker;
use super::aot::{StoreIndex, Subject};
use super::flow::FlowIndexes;
use crate::atom::Atom;
use crate::bind::SymbolId;
use crate::hir::{ClassId, ExprId, ExprsByKind, FnId, PatId};
use crate::program::FileId;
use crate::types::TypeId;
use crate::util::FxHashMap;
use std::sync::{Arc, OnceLock};

pub(super) type ReadsOfFields = FxHashMap<(ClassId, Atom), Vec<ExprId>>;

#[derive(Default)]
pub struct SharedIndexes<'s> {
    pub(super) flow: FlowIndexes,
    exprs_by_kind: OnceLock<Arc<ExprsByKind>>,
    pub(super) references_to_bindings: OnceLock<&'s [(SymbolId, ExprId)]>,
    pub(super) references_to_this: OnceLock<&'s [(FnId, ExprId)]>,
    pub(super) reads_of_fields_off_this: OnceLock<Arc<ReadsOfFields>>,
    pub(super) store_index: OnceLock<StoreIndex<'s>>,
    pub(super) lists_of_lists: OnceLock<FxHashMap<PatId, bool>>,
    pub(super) inferred_types: OnceLock<Vec<(Subject, TypeId)>>,
}

impl SharedIndexes<'_> {
    pub const COUNT: usize = 7;

    pub fn note_lists_of_lists(&self, answers: FxHashMap<PatId, bool>) {
        let _ = self.lists_of_lists.set(answers);
    }
}

impl<'s> Checker<'_, 's> {
    pub(super) fn begin_sharing_indexes(&mut self, file: FileId) -> Arc<SharedIndexes<'s>> {
        let indexes = SharedIndexes {
            flow: FlowIndexes::of(&self.flow_memo, file),
            ..SharedIndexes::default()
        };
        let mut known = self.exprs_by_kind.iter().flatten();
        if let Some((_, by_kind)) = known.find(|it| it.0 == file) {
            let _ = indexes.exprs_by_kind.set(Arc::clone(by_kind));
        }
        let indexes = Arc::new(indexes);
        self.share_indexes(file, &indexes);
        indexes
    }

    pub fn share_indexes(&mut self, file: FileId, indexes: &Arc<SharedIndexes<'s>>) {
        self.shared_indexes = Some((file, Arc::clone(indexes)));
    }

    pub(super) fn end_sharing_indexes(&mut self) {
        self.shared_indexes = None;
    }

    pub(super) fn indexes_of_parts(&self, file: FileId) -> Option<Arc<SharedIndexes<'s>>> {
        let shared = self.shared_indexes.as_ref();
        let indexes = shared.filter(|it| it.0 == file);
        indexes.map(|it| Arc::clone(&it.1))
    }

    pub(super) fn shared_exprs_by_kind(&self, file: FileId) -> Arc<ExprsByKind> {
        let create = || Arc::new(ExprsByKind::new(self.hir(file)));
        match self.indexes_of_parts(file) {
            Some(indexes) => Arc::clone(indexes.exprs_by_kind.get_or_init(create)),
            None => create(),
        }
    }
}
