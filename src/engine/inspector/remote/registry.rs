use core::cell::{Cell, RefCell};

use bun_engine_macros::cell;
use bun_engine_text::{StringRef, Text};
use bun_engine_vm::{
    Cx, FastHashMap, Field, Gc, GlobalObject, JsCell, JsObject, JsResult, Message, RootVec, Strong,
    TracedMap, TracedVec, Value, Vm, Weak, root_vec,
};

use crate::protocol::Json;

/// The objects of a realm that a frontend has an id for.
#[cell]
pub(crate) struct Registry {
    base: JsCell,
    id: i32,
    global: Gc<GlobalObject>,
    next_object_id: Cell<u32>,
    pub(self) objects: TracedMap<u32, Value>,
    groups: RefCell<FastHashMap<StringRef, Vec<u32>>>,
    group_names: RefCell<FastHashMap<u32, StringRef>>,
    /// `$1` and those after it.
    pub(super) saved_results: TracedVec<Value>,
    next_saved_result: Cell<usize>,
    /// `$_`
    pub(super) last_result: Field<Option<Value>>,
    /// `$exception`
    pub(crate) exception: Field<Option<Value>>,
    pub(super) command_line_functions: Field<Option<Gc<JsObject>>>,
    /// Since that of the outermost collection began.
    nested_previews: Cell<u32>,
}

impl Registry {
    pub(crate) fn id(&self) -> i32 {
        self.id
    }

    pub(crate) fn global(&self) -> Gc<GlobalObject> {
        self.global
    }

    /// An empty name is no group.
    pub(super) fn bind(&self, value: Value, group: &StringRef) -> u32 {
        let id = self.next_object_id.get();
        self.next_object_id.set(id.wrapping_add(1));
        self.objects().insert(id, value);
        if !group.is_empty() {
            let mut groups = self.groups.borrow_mut();
            groups.entry(group.clone()).or_default().push(id);
            self.group_names.borrow_mut().insert(id, group.clone());
        }
        id
    }

    pub(super) fn id_text(&self, object: u32) -> StringRef {
        let realm = self.id;
        format_args!("{{\"injectedScriptId\":{realm},\"id\":{object}}}").into_string()
    }

    pub(crate) fn find(&self, id: Option<u32>) -> Option<Value> {
        self.objects().get(&id?)
    }

    pub(crate) fn group_of(&self, id: Option<u32>) -> StringRef {
        let names = self.group_names.borrow();
        id.and_then(|id| names.get(&id).cloned())
            .unwrap_or_default()
    }

    pub(crate) fn release(&self, id: u32) {
        self.objects().remove(&id);
        self.group_names.borrow_mut().remove(&id);
    }

    fn release_group(&self, group: &StringRef) {
        if group.text().eq_ascii("console") {
            self.set_last_result(None);
            self.saved_results().clear();
            self.next_saved_result.set(0);
        }
        let ids = self.groups.borrow_mut().remove(group);
        ids.into_iter().flatten().for_each(|id| self.release(id));
    }

    pub(super) fn nested_previews(&self) -> &Cell<u32> {
        &self.nested_previews
    }

    /// The `n` of `$n`, or zero.
    pub(super) fn save_result(&self, cx: &Cx, result: Value) -> JsResult<usize> {
        const MAX_SAVED: usize = 99;
        self.set_last_result(Some(result));
        if result.is_undefined_or_null() {
            return Ok(0);
        }
        for (index, saved) in self.saved_results().iter().enumerate() {
            if saved.strict_equals(cx, result)? {
                return Ok(index + 1);
            }
        }
        let index = self.next_saved_result.get();
        self.next_saved_result.set((index + 1) % MAX_SAVED);
        if index < self.saved_results().len() {
            self.saved_results().set(index, result);
        } else {
            self.saved_results().push(result);
        }
        Ok(index + 1)
    }
}

/// `Runtime.RemoteObjectId` or `Debugger.CallFrameId`.
pub(crate) struct ObjectId {
    pub(crate) realm: i32,
    pub(crate) object: Option<u32>,
    pub(crate) frame: Option<i32>,
}

impl ObjectId {
    pub(crate) fn parse(vm: &Vm, text: Text<'_>) -> Option<ObjectId> {
        let json = Json::parse(vm, text)?;
        let json = json.as_object()?;
        Some(ObjectId {
            realm: json.integer("injectedScriptId")?,
            object: json.integer("id").map(|id| id as u32),
            frame: json.integer("ordinal"),
        })
    }
}

struct Realm {
    global: Weak<GlobalObject>,
    registry: Option<Strong<Gc<Registry>>>,
}

/// By id, from one.
#[derive(Default)]
pub(crate) struct Registries(RefCell<Vec<Realm>>);

impl Registries {
    pub(crate) fn id_of_realm(&self, cx: &Cx) -> i32 {
        let mut realms = self.0.borrow_mut();
        let known = (realms.iter()).position(|it| it.global.get(cx) == Some(cx.global()));
        let index = known.unwrap_or_else(|| {
            realms.push(Realm {
                global: Weak::new(cx, cx.global()),
                registry: None,
            });
            realms.len() - 1
        });
        index as i32 + 1
    }

    pub(crate) fn of_realm(&self, cx: &Cx) -> Gc<Registry> {
        let id = self.id_of_realm(cx);
        self.find(cx, id).unwrap_or_else(|| {
            let registry = cx.allocate::<Registry>(RegistryInit {
                base: cx.shape_for::<Registry>(),
                id,
                global: cx.global(),
                next_object_id: Cell::new(1),
                groups: RefCell::default(),
                group_names: RefCell::default(),
                next_saved_result: Cell::new(0),
                last_result: None,
                exception: None,
                command_line_functions: None,
                nested_previews: Cell::new(0),
            });
            self.0.borrow_mut()[id as usize - 1].registry = Some(Strong::new(cx, registry));
            registry
        })
    }

    pub(crate) fn find(&self, vm: &Vm, id: i32) -> Option<Gc<Registry>> {
        let realms = self.0.borrow();
        let realm = realms.get((id as usize).wrapping_sub(1))?;
        Some(realm.registry.as_ref()?.get(vm))
    }

    pub(crate) fn all(&self, vm: &Vm) -> RootVec<Gc<Registry>> {
        let (realms, mut all) = (self.0.borrow(), root_vec());
        all.extend((realms.iter()).filter_map(|it| Some(it.registry.as_ref()?.get(vm))));
        all
    }

    pub(crate) fn release_group(&self, vm: &Vm, group: &StringRef) {
        self.all(vm).iter().for_each(|it| it.release_group(group));
    }

    pub(crate) fn clear(&self) {
        self.0.take();
    }
}
