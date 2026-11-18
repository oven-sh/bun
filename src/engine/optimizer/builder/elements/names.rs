//! Keys that are names.

use bun_engine_bytecode::Register;
use bun_engine_codegen::ir::{Access, AccessFlags, State, Type, Value as Ssa};
use bun_engine_text::Identifier;
use bun_engine_vm::caches::ENTRY_SHIFT;
use bun_engine_vm::code::metadata::{ArrayAccess, GetByVal};
use bun_engine_vm::ic::{AccessCases, AccessKind};
use bun_engine_vm::{ArrayProfile, JsString, JsSymbol, SpeculatedType as T};

use crate::builder::{Builder, Built};
use crate::graph::{Cache, ExitKind, Kind, SlotSearch, heaps};

const MAX_LENGTH: usize = 256;

impl Builder<'_> {
    fn constant_name(&self, key: Ssa) -> Option<Identifier> {
        if let Some(symbol) = self.constant_cell::<JsSymbol>(key) {
            return Some(symbol.name().to_identifier());
        }
        let text = self.constant_cell::<JsString>(key)?.try_view()?;
        let is_short = text.text().len() <= MAX_LENGTH;
        let name = is_short.then(|| Identifier::new(text.text()))?;
        name.name().as_index().is_none().then_some(name)
    }

    fn may_be_name(&self, key: Ssa, indexed: &ArrayProfile) -> bool {
        indexed.modes().is_empty() || self.is(key, T::STRING | T::SYMBOL)
    }

    fn likely_name(&self, key: Ssa, cases: &AccessCases) -> Option<Identifier> {
        self.constant_name(key).or_else(|| {
            let first = cases.iter().next()?.key()?.to_identifier();
            let ty = if first.name().is_symbol() {
                T::SYMBOL
            } else {
                T::STRING
            };
            (cases.iter().all(|it| it.key() == Some(first.name()))
                && ty.contains(self.expected(key))
                && !self.has_exited(ExitKind::BadIdentity))
            .then_some(first)
        })
    }

    fn check_name(&mut self, key: Ssa, name: &Identifier) {
        self.dependencies.names.push(name.clone());
        if self.constant_name(key).as_ref() == Some(name) {
            return;
        }
        let expected = self.name(name.name());
        if name.name().is_symbol() {
            let symbol = self.check_type_or(key, T::SYMBOL, ExitKind::BadIdentity);
            let found = self.load_immutable(Type::I64, symbol, JsSymbol::OFFSET_OF_NAME);
            let differs = self.ir().not_equal(found, expected);
            self.exit_if(differs, ExitKind::BadIdentity);
        } else {
            let string = self.check_type_or(key, T::STRING, ExitKind::BadIdentity);
            if self.has_exited(ExitKind::BadName) {
                self.node(Kind::CheckText, &[string, expected], 0);
            } else {
                let offset = JsString::OFFSET_OF_FIBER as i32;
                let found = self.load(Type::I64, string, offset, heaps::STRING_FIBER);
                let differs = self.ir().not_equal(found, expected);
                self.exit_if(differs, ExitKind::BadName);
            }
        }
    }

    /// Loads from the slot, or stores the value. `None` if nothing has been done.
    fn search_by_key(
        &mut self,
        object: Ssa,
        key: Ssa,
        value: Option<Ssa>,
        cases: &AccessCases,
    ) -> Option<Ssa> {
        let failures = [
            ExitKind::BadType,
            ExitKind::ExoticObject,
            ExitKind::Inconvertible,
        ];
        let (names, expected) = (T::STRING | T::SYMBOL, self.expected(key));
        // As long as there is another tier to come, the caches are to go on learning.
        let has_learned = cases.is_megamorphic() || self.is_full() && cases.iter().nth(1).is_some();
        let is_cached = has_learned && cases.summary().is_plain();
        let is_table = value.is_none()
            && (cases.last()).is_some_and(|it| it.kind() == AccessKind::Generic || it.did_miss())
            && T::FINAL_OBJECT.contains(self.expected(object));
        if expected.is_empty()
            || !names.contains(expected)
            || !T::OBJECT.contains(self.expected(object))
            || !is_cached && !is_table
            || failures.into_iter().any(|it| self.has_exited(it))
        {
            return None;
        }
        let ty = [T::STRING, T::SYMBOL]
            .into_iter()
            .find(|it| it.contains(expected));
        let (object, checked) = (
            self.check_type(object, T::OBJECT),
            self.check_type(key, ty.unwrap_or(names)),
        );
        let known = (self.graph).intern_type(self.knowledge.type_of(&self.graph, key));
        let key = self.node(Kind::AsName, &[checked], known);
        let access = Access::new(heaps::STRING_FIBER, AccessFlags::ALWAYS_READABLE);
        let name = (self.ir()).load(Type::I64, key, JsString::OFFSET_OF_FIBER as i32, access);
        let found = if is_cached {
            self.search_by_name(object, name, known, value)
        } else {
            self.node(Kind::LookUpName, &[object, name], 0)
        };
        // It owns the name.
        self.insert_node(Kind::KeepAlive, &[self.graph.root(key)], 0, State::NONE);
        Some(found)
    }

    fn search_by_name(&mut self, object: Ssa, name: Ssa, known: u32, value: Option<Ssa>) -> Ssa {
        let hash = self.node(Kind::HashName, &[name], known);
        let hash = self.ir().shl(hash, ENTRY_SHIFT);
        self.graph.searches.push(SlotSearch {
            name: None,
            usual_byte_offset: None,
        });
        let data = self.graph.searches.len() as u32 - 1;
        match value.map(|it| self.graph.root(it)) {
            None => self.node(Kind::SearchAndLoad, &[object, name, hash], data),
            Some(value) => {
                let slot = self.node(Kind::SearchForStore, &[object, value, name, hash], data);
                self.store_into(object, slot, 0, heaps::NAMED, value);
                self.insert_node(Kind::StoreBarrier, &[object], 0, State::NONE);
                self.node(Kind::MayHaveFired, &[], 0);
                slot
            }
        }
    }

    /// False if nothing has been done.
    pub(super) fn get_by_name(
        &mut self,
        dst: Register,
        [object, key]: [Ssa; 2],
        entry: &GetByVal,
        metadata: u32,
    ) -> Built<bool> {
        let (cases, cache) = (&entry.cases, Cache::GetByVal);
        if !self.may_be_name(key, &entry.array) {
            return Ok(false);
        }
        let Some(name) = self.likely_name(key, cases) else {
            let value = self.search_by_key(object, key, None, cases);
            value.inspect(|&value| {
                self.profile_result(value, metadata);
                self.set(dst, value);
            });
            return Ok(value.is_some());
        };
        let Some(plan) = self.plan_load(object, name.name(), true, None, cases) else {
            return Ok(false);
        };
        self.check_name(key, &name);
        let result = self.load_as_planned(dst, object, name.name(), &plan, metadata, |this| {
            this.cached_load(cache, &entry.access, &[object, key], metadata)
        })?;
        result.inspect(|&result| self.set(dst, result));
        Ok(true)
    }

    pub(super) fn put_by_name(
        &mut self,
        [object, key, value]: [Ssa; 3],
        (entry, cache): (&ArrayAccess, Cache<ArrayAccess>),
        metadata: u32,
    ) -> Built<bool> {
        if !self.may_be_name(key, &entry.array) {
            return Ok(false);
        }
        let sets = cache != Cache::PutByValDirect;
        let Some(name) = self.likely_name(key, &entry.cases) else {
            return Ok(
                sets && (self.search_by_key(object, key, Some(value), &entry.cases)).is_some()
            );
        };
        let Some(plan) = self.plan_store(object, name.name(), !sets, None, &entry.cases) else {
            return Ok(false);
        };
        self.check_name(key, &name);
        self.store_as_planned([object, value], name.name(), &plan, metadata, |this| {
            this.cached(cache, entry, &[object, key, value]);
        })?;
        Ok(true)
    }
}
