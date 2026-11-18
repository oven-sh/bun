//! `Object` and `Reflect`.

use bun_engine_asm::FloatCond;
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::{
    CachedNames, ElementKind, IndexingMode, Intrinsic, JsArray, RealmSlot, RealmWatchpoint,
    ShapeRareData, SpeculatedType as T,
};

use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::builder::fork::Odds;
use crate::graph::{ExitKind, Kind};

impl Builder<'_> {
    pub(super) fn object_intrinsic(
        &mut self,
        which: Intrinsic,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        let &[_, value, ..] = site.arguments else {
            return None;
        };
        match which {
            Intrinsic::ReflectGetPrototypeOf => self.prototype_of_object(value),
            Intrinsic::ObjectGetPrototypeOf => (self.prototype_of_object(value))
                .or_else(|| self.prototype_of_primitive(value, site.callee)),
            Intrinsic::ObjectIs => {
                let other = (site.arguments.get(2).copied()).unwrap_or_else(|| self.undefined());
                let is_same = self.is_same_value(value, other);
                Some(self.box_boolean(is_same))
            }
            Intrinsic::ObjectKeys => self.own_keys(CachedNames::EnumerableStrings, site),
            Intrinsic::ObjectGetOwnPropertyNames => self.own_keys(CachedNames::Strings, site),
            Intrinsic::ObjectGetOwnPropertySymbols => self.own_keys(CachedNames::Symbols, site),
            Intrinsic::ReflectOwnKeys => self.own_keys(CachedNames::StringsAndSymbols, site),
            _ => None,
        }
    }

    fn prototype_of_object(&mut self, value: Ssa) -> Option<Ssa> {
        self.expects_argument(value, T::OBJECT).then(|| {
            let object = self.check_argument(value, T::OBJECT);
            self.prototype_of(object, T::OBJECT | T::NULL)
        })
    }

    fn prototype_of_primitive(&mut self, value: Ssa, callee: Ssa) -> Option<Ssa> {
        let realm = self.realm_of_callee(callee)?;
        let (ty, slot) = [
            (T::STRING, RealmSlot::string_prototype),
            (T::BOXED_NUMBER, RealmSlot::number_prototype),
            (T::BOOLEAN, RealmSlot::boolean_prototype),
            (T::SYMBOL, RealmSlot::symbol_prototype),
            (T::BIGINT, RealmSlot::bigint_prototype),
        ]
        .into_iter()
        .find(|it| self.expects_argument(value, it.0))?;
        self.check_argument(value, ty);
        Some(self.cell(realm.slot(self.vm, slot)))
    }

    /// SameValue
    fn is_same_value(&mut self, first: Ssa, second: Ssa) -> Ssa {
        const NO_NUMBER: T = T::HEAP_TOP.difference(T::BOXED_NUMBER);
        let both = [first, second];
        let are_expected = |ty, failure| both.iter().all(|&it| self.expects(it, ty, failure));
        if are_expected(T::INT32, ExitKind::BadType) {
            let [first, second] = both.map(|it| self.as_int32(it));
            return self.ir().equal(first, second);
        }
        if are_expected(T::FULL_NUMBER, ExitKind::NotANumber) {
            return self.is_same_number(both);
        }
        if let Some(&other) = (both.iter()).find(|&&it| self.expects_argument(it, NO_NUMBER)) {
            self.check_argument(other, NO_NUMBER);
            return self.node(Kind::StrictEqual, &both.map(|it| self.graph.root(it)), 0);
        }
        let of_both = |this: &mut Self, is_number| {
            let is_same = match is_number {
                true => this.is_same_number(both),
                false => this.int32(0),
            };
            Some(this.box_boolean(is_same))
        };
        let is_number = self.is_type(first, T::BOXED_NUMBER);
        let answer = self.choose(is_number, Odds::Even, |this, is_number| {
            if is_number {
                let is_number = this.is_type(second, T::BOXED_NUMBER);
                return this.choose(is_number, Odds::Even, of_both);
            }
            let is_same = this.node(Kind::StrictEqual, &both.map(|it| this.graph.root(it)), 0);
            Some(this.box_boolean(is_same))
        });
        self.to_boolean(answer.expect("nothing ends"))
    }

    fn is_same_number(&mut self, both: [Ssa; 2]) -> Ssa {
        let [first, second] = both.map(|it| self.as_number(it));
        let mut ir = self.ir();
        let [is_nan, is_nan_too] =
            [first, second].map(|it| ir.float_compare(FloatCond::NeOrUnordered, it, it));
        let (first, second) = (ir.bitcast(first), ir.bitcast(second));
        let (are_nan, have_same_bits) = (ir.and(is_nan, is_nan_too), ir.equal(first, second));
        ir.or(have_same_bits, are_nan)
    }

    /// In an array that shares the list which the shape keeps.
    fn own_keys(&mut self, kind: CachedNames, site: &CallSite<'_>) -> Option<Ssa> {
        let (value, realm) = (site.arguments[1], self.realm_of_callee(site.callee)?);
        if !self.expects_argument(value, T::OBJECT)
            || !self.watch(realm.watchpoints(self.vm, RealmWatchpoint::NotHavingABadTime))
        {
            return None;
        }
        let mode = IndexingMode::array(ElementKind::Contiguous).copy_on_write();
        let allocation = self.allocation(realm.original_array_shape(mode), size_of::<JsArray>())?;
        let object = self.check_argument(value, T::OBJECT);
        let known = self.knowledge.shapes_of(&mut self.graph, object).only();
        if let Some(list) = known.and_then(|it| self.shape_at(it).cached_names(kind)) {
            let (length, list) = (self.int32(list.len() as i32), self.cell(list.upcast()));
            let array = self.made_with_shape(Kind::ShareList, &[list], allocation);
            self.learn_length(array, length);
            return Some(array);
        }
        let offset = ShapeRareData::offset_of_cached_names(kind) as u32;
        let list = self.node(Kind::KeptNames, &[object], offset);
        Some(self.quickly_or_by_call(site, |this, slow| {
            let is_missing = this.ir().is_zero(list);
            this.leave_if(is_missing, Odds::Low, slow);
            this.made_with_shape(Kind::ShareList, &[list], allocation)
        }))
    }
}
