//! What the instructions for names that are searched for remember. The static scopes around an instruction are always
//! the same, so without a `with` scope only the variables of `eval` code can change what a name finds.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_engine_bytecode::SlotKind;
use bun_engine_text::PropertyName;

use super::realm_of_scope;
use crate::code::metadata::{GlobalAccess, ResolveDynamic};
use crate::{
    CellType, Cx, Environment, FastHashMap, Gc, GlobalLexicals, GlobalPlace, JsCell, JsObject,
    PropertyOffset, Shape, ShapeId, Vm, WatchpointSet, WatchpointState,
};

/// The names that `eval` code has declared in scopes of functions, as far as 16 bits of their hash tell them apart.
pub(crate) struct EvalVariableNames {
    epoch: Cell<u32>,
    declared: RefCell<Vec<u64>>,
    watchpoints: RefCell<FastHashMap<u16, Rc<WatchpointSet>>>,
}

impl EvalVariableNames {
    pub(crate) const OFFSET_OF_EPOCH: usize = core::mem::offset_of!(EvalVariableNames, epoch);
}

impl Default for EvalVariableNames {
    fn default() -> EvalVariableNames {
        EvalVariableNames {
            epoch: Cell::new(1),
            declared: RefCell::default(),
            watchpoints: RefCell::default(),
        }
    }
}

fn word_and_bit(name: PropertyName<'_>) -> (usize, u64) {
    let key = name.hash() as u16;
    (usize::from(key / 64), 1 << (key % 64))
}

impl Vm {
    /// Changes when `eval` code declares a variable of a name that it has not declared anywhere before.
    #[inline(always)]
    pub fn eval_variables_epoch(&self) -> u32 {
        self.services.code.eval_variable_names.epoch.get()
    }

    fn may_be_eval_variable(&self, name: PropertyName<'_>) -> bool {
        let (word, bit) = word_and_bit(name);
        let declared = self.services.code.eval_variable_names.declared.borrow();
        declared.get(word).is_some_and(|it| it & bit != 0)
    }

    /// Valid until `eval` code declares a variable of that name. `None` if it may have.
    pub fn eval_variable_watchpoints(&self, name: PropertyName<'_>) -> Option<Rc<WatchpointSet>> {
        if self.may_be_eval_variable(name) {
            return None;
        }
        let names = &self.services.code.eval_variable_names;
        let mut watchpoints = names.watchpoints.borrow_mut();
        let set = (watchpoints.entry(name.hash() as u16))
            .or_insert_with(|| WatchpointSet::create(WatchpointState::Watched));
        Some(Rc::clone(set))
    }

    pub(super) fn will_declare_eval_variable(&self, name: PropertyName<'_>) {
        const WORDS: usize = (u16::MAX as usize + 1) / 64;
        if self.may_be_eval_variable(name) {
            return;
        }
        let (names, (word, bit)) = (&self.services.code.eval_variable_names, word_and_bit(name));
        {
            let mut declared = names.declared.borrow_mut();
            declared.resize(WORDS, 0);
            declared[word] |= bit;
        }
        names.epoch.update(|epoch| epoch + 1);
        let watchpoints = (names.watchpoints.borrow_mut()).remove(&(name.hash() as u16));
        if let Some(watchpoints) = watchpoints {
            watchpoints.invalidate(self);
        }
    }
}

impl ResolveDynamic {
    /// How many parents up from `scope` the name is declared in the source.
    fn depth_of_declaration(scope: &Environment, name: PropertyName<'_>) -> u32 {
        let declares = |it: Gc<Environment>| it.template().scope().find(name).is_some();
        (scope.chain().position(declares)).map_or(Self::GLOBAL, |depth| depth as u32)
    }

    /// After `name` has been found in `holder`, from `scope` on.
    pub(super) fn remember(
        &self,
        vm: &Vm,
        scope: &Environment,
        name: PropertyName<'_>,
        holder: Gc<JsCell>,
    ) {
        self.epoch.set(0);
        self.shape.set(ShapeId::NONE);
        let declared_at = Self::depth_of_declaration(scope, name);
        let (mut extensible, mut extensible_count, mut is_variable) = (None, 0, false);
        for (depth, environment) in (0..declared_at).zip(scope.chain()) {
            if environment.cell_type() == CellType::WithScope {
                self.depth.set(declared_at);
                return self.variables_slot.set(Self::PASSES_WITH);
            }
            if let Some(slot) = environment.template().scope().eval_variables_slot()
                && !is_variable
            {
                let variables = environment.eval_variables();
                is_variable = variables.is_some_and(|it| it == holder);
                extensible = Some((depth, slot, variables));
                extensible_count += 1;
            }
        }
        if holder.cell_type() == CellType::WithScope {
            return;
        }
        if is_variable {
            self.depth.set(Self::VARIABLES);
        } else {
            self.depth.set(declared_at);
            if extensible_count == 0 || !vm.may_be_eval_variable(name) {
                return self.epoch.set(vm.eval_variables_epoch());
            }
        }
        let Some((depth, slot, variables)) = extensible.filter(|_| extensible_count == 1) else {
            return;
        };
        let shape = match variables {
            Some(variables) => variables.shape(),
            None => realm_of_scope(scope.as_cell().into()).null_prototype_object_shape(),
        };
        let is_cacheable = match is_variable {
            true => shape.property_accesses_are_cacheable(),
            false => shape.absence_is_cacheable() && shape.get(name).is_none(),
        };
        if let (Ok(depth), Ok(slot)) = (depth.try_into(), slot.try_into())
            && slot != Self::PASSES_WITH
            && is_cacheable
        {
            self.shape.set(shape.id());
            self.variables_depth.set(depth);
            self.variables_slot.set(slot);
        }
    }
}

impl GlobalAccess {
    fn set_slot(&self, shape: &Shape, byte_offset: isize) {
        self.shape.set(shape.id());
        self.byte_offset.set(byte_offset as i32);
    }

    fn set_property(&self, vm: &Vm, shape: &Shape, offset: PropertyOffset, stores: bool) {
        if stores {
            shape.did_cache_property_replacement(vm, offset);
        }
        self.set_slot(shape, offset.byte_offset());
    }

    /// For `get_dynamic` and `put_dynamic`, after the access. With a shape the value is in the holder that has it. No
    /// environment but one can be the holder.
    pub fn remember_dynamic(
        &self,
        cx: &Cx,
        holder: Gc<JsCell>,
        name: PropertyName<'_>,
        stores: bool,
    ) {
        use SlotKind::{Callee, Const, LazyFunction, Let, Variable};
        if holder.cell_type() == CellType::WithScope {
            return;
        }
        let has_run = self.has_run();
        self.shape.set(ShapeId::NONE);
        self.byte_offset.set(Self::NO_EPOCH);
        self.pointer.set(0);
        if let Some(environment) = holder.downcast::<Environment>() {
            let template = environment.template();
            if let Some(slot) = template.scope().find(name)
                && (matches!(slot.kind, Variable | Let | LazyFunction)
                    || (!stores && matches!(slot.kind, Const | Callee)))
            {
                let byte_offset = Environment::allocation_size(slot.index);
                self.set_slot(&holder.shape(), byte_offset as isize);
            }
            return;
        }
        if holder.cell_type() != CellType::GlobalObject {
            let shape = holder.cast::<JsObject>().shape();
            if let Some((offset, _)) = shape.get(name)
                && shape.property_accesses_are_cacheable()
            {
                self.set_property(cx, &shape, offset, stores);
            }
            return;
        }
        let global = cx.global();
        let place = match stores {
            true => global.place_for_store(name, GlobalLexicals::Visible),
            false => global.place_for_load(name, GlobalLexicals::Visible),
        };
        match place {
            GlobalPlace::Lexical(binding) | GlobalPlace::Variable(binding) => {
                (self.pointer).set(core::ptr::from_ref(binding).expose_provenance());
            }
            GlobalPlace::Property(shape, offset) if holder == global && (has_run || !stores) => {
                self.set_property(cx, &shape, offset, stores);
            }
            GlobalPlace::Property(..) | GlobalPlace::Unknown => {}
        }
    }
}
