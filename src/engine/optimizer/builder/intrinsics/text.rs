use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::{Intrinsic, SpeculatedType as T};

use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::graph::{ExitKind, Kind};

impl Builder<'_> {
    pub(super) fn text_intrinsic(&mut self, which: Intrinsic, site: &CallSite<'_>) -> Option<Ssa> {
        let failures = [
            ExitKind::BadElements,
            ExitKind::NotAnInteger,
            ExitKind::OutOfBounds,
        ];
        if failures.into_iter().any(|kind| self.has_exited(kind)) {
            return None;
        }
        let results = self.prediction_at(site.metadata);
        match (which, site.arguments) {
            (Intrinsic::CharCodeAt | Intrinsic::CharAt, &[string, index, ..]) => {
                if !self.all_expected(&[string], T::STRING)
                    || !self.all_expected(&[index], T::INT32)
                    || results.intersects(T::PURE_NAN)
                {
                    return None;
                }
                let unit = self.unit_at(string, index);
                Some(if which == Intrinsic::CharCodeAt {
                    self.box_int32(unit)
                } else {
                    self.node(Kind::StringFromUnit, &[unit], 0)
                })
            }
            (Intrinsic::FromCharCode, &[_, code]) if self.all_expected(&[code], T::INT32) => {
                let bits = self.as_index(code);
                let unit = self.ir().and(bits, i32::from(u16::MAX));
                Some(self.node(Kind::StringFromUnit, &[unit], 0))
            }
            _ => None,
        }
    }
}
