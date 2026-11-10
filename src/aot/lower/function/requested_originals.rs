use bun_sema::hir::FnId;
use bun_sema::import_sites::{find_request_positions, find_requested_originals};

use crate::ir::StringId;
use crate::ir::generated::SourceRange;
use crate::lower::FileLowering;

#[derive(Default)]
pub(super) struct RequestedOriginals {
    pub(super) may_be_any_module: bool,
    pub(super) names: Vec<StringId>,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn find_requested_originals(
        &mut self,
        function: FnId,
        text: SourceRange,
    ) -> RequestedOriginals {
        if !self.inputs.modules.is_any_module_named_by_mock() {
            return RequestedOriginals::default();
        }
        let hir = self.hir;
        let positions = self
            .request_positions
            .get_or_init(|| find_request_positions(hir));
        let first = positions.partition_point(|&it| it < text.start);
        if positions.get(first).is_none_or(|&it| it >= text.end) {
            return RequestedOriginals::default();
        }
        let queries = &*self.queries;
        let bytes_of = |name| queries.atom_bytes(name);
        let found = find_requested_originals(hir, self.bound, function, bytes_of);
        RequestedOriginals {
            may_be_any_module: found.may_be_any_module,
            names: (found.names.into_iter())
                .map(|name| self.intern_bytes(&name))
                .collect(),
        }
    }
}
