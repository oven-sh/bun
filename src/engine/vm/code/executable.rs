use core::cell::{Cell, OnceCell, RefCell};
use core::hash::BuildHasher;
use core::mem::offset_of;
use core::ptr::fn_addr_eq;
use std::rc::Rc;

use bun_engine_bytecode::{
    Code, CodeFlags, Eval, FunctionInfo, FunctionKind, FunctionRef, Module, Origin, Script,
    Specialization, StaticScope, Visibility,
};
use bun_engine_macros::{Trace, cell};
use bun_engine_text::{StringRef, Text, names};

use super::eval::EvalKey;
use super::lease::CodeEdge;
use crate::heap::{OnceBox, Owned};
use crate::{
    CellType, CodeBlock, Cx, FastHasher, Field, Gc, GcFree, GlobalObject, InlineWatchpointSet,
    Intrinsic, JsArray, JsCell, JsFunction, JsResult, JsString, NativeFunction, RealmSlot,
    ScopeTemplate, Shape, SourceCode, SourceProviderRef, Trace, TracedMap, TypeFlags, Visitor, Vm,
    WatchpointState, WeakField, call,
};

/// What a call goes through: it stores the code block in the new frame and calls the entry.
#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL, export = "engine_class_Executable")]
pub struct Executable {
    base: JsCell,
    entries: [Cell<usize>; 2],
    code_blocks: [CodeEdge; 2],
}

impl Executable {
    pub const fn offset_of_entry(specialization: Specialization) -> usize {
        offset_of!(Executable, entries) + specialization as usize * size_of::<usize>()
    }

    pub const fn offset_of_code_block(specialization: Specialization) -> usize {
        offset_of!(Executable, code_blocks) + specialization as usize * size_of::<CodeEdge>()
    }

    pub(crate) fn init(shape: Gc<Shape>, call: usize, construct: usize) -> ExecutableInit {
        ExecutableInit {
            base: shape,
            entries: [Cell::new(call), Cell::new(construct)],
            code_blocks: [None; 2].map(|none| CodeEdge(Field::new(none))),
        }
    }

    #[inline(always)]
    pub fn entry(&self, specialization: Specialization) -> usize {
        self.entries[specialization as usize].get()
    }

    #[inline(always)]
    pub fn code_block(&self, specialization: Specialization) -> Option<Gc<CodeBlock>> {
        self.code_blocks[specialization as usize].0.get()
    }

    /// # Safety
    /// `entry` is code that expects to be called in that way, with that code block.
    pub unsafe fn install(
        &self,
        specialization: Specialization,
        entry: usize,
        code_block: Option<Gc<CodeBlock>>,
    ) {
        self.entries[specialization as usize].set(entry);
        if let Some(old) = self.code_block(specialization) {
            old.set_entry(specialization, None);
        }
        if let Some(new) = code_block {
            new.set_entry(specialization, Some(entry));
        }
        // SAFETY: a field of its own.
        unsafe {
            self.code_blocks[specialization as usize]
                .0
                .set(self, code_block)
        };
    }

    pub(crate) fn code_block_for_call_concurrently(&self) -> Option<Gc<CodeBlock>> {
        self.code_blocks[Specialization::Call as usize]
            .0
            .get_published()
    }

    #[inline(always)]
    pub fn is_native(&self) -> bool {
        self.cell_type() == CellType::NativeExecutable
    }

    pub fn intrinsic(&self) -> Intrinsic {
        if let Some(native) = self.downcast::<NativeExecutable>() {
            return native.intrinsic;
        }
        self.downcast::<FunctionExecutable>()
            .map_or(Intrinsic::None, |function| function.intrinsic.get())
    }

    pub fn visibility(&self) -> Visibility {
        if let Some(native) = self.downcast::<NativeExecutable>() {
            return native.visibility;
        }
        self.downcast::<FunctionExecutable>()
            .map_or(Visibility::Public, |function| function.info().visibility())
    }
}

#[cell(cell_type = NativeExecutable, export = "engine_class_NativeExecutable")]
pub struct NativeExecutable {
    base: Executable,
    function: NativeFunction,
    constructor: NativeFunction,
    name: StringRef,
    pub(self) cached_source_text: Field<Option<Gc<JsString>>>,
    length: u32,
    intrinsic: Intrinsic,
    visibility: Visibility,
    is_named_as_bound: Cell<bool>,
}

fn hash_of_native(function: NativeFunction, name: &StringRef) -> u64 {
    FastHasher::default().hash_one((function as usize, name.hash()))
}

impl NativeExecutable {
    pub const OFFSET_OF_FUNCTION: usize = offset_of!(NativeExecutable, function);
    pub const OFFSET_OF_CONSTRUCTOR: usize = offset_of!(NativeExecutable, constructor);

    pub fn create(
        vm: &Vm,
        length: u32,
        name: StringRef,
        function: NativeFunction,
        constructor: NativeFunction,
        intrinsic: Intrinsic,
        visibility: Visibility,
    ) -> Gc<NativeExecutable> {
        let call = (vm.hooks().native_call_entry)(vm, intrinsic);
        let shape = vm.shapes.native_executable();
        let executable = vm.allocate::<NativeExecutable>(NativeExecutableInit {
            base: Executable::init(shape, call, call::native_construct_entry()),
            function,
            constructor,
            name,
            cached_source_text: None,
            length,
            intrinsic,
            visibility,
            is_named_as_bound: Cell::new(false),
        });
        if vm.watches_native_calls() {
            executable.watch_calls(vm, true);
        }
        executable
    }

    /// One for all functions that are alike.
    pub fn shared(
        vm: &Vm,
        length: u32,
        name: StringRef,
        function: NativeFunction,
        constructor: NativeFunction,
        intrinsic: Intrinsic,
        visibility: Visibility,
    ) -> Gc<NativeExecutable> {
        let is_alike = |it: &NativeExecutable| {
            fn_addr_eq(it.function, function)
                && fn_addr_eq(it.constructor, constructor)
                && (it.length, it.visibility) == (length, visibility)
                && it.name == name
        };
        let hash = hash_of_native(function, &name);
        let shared = vm.native_executables.find(vm, hash, is_alike);
        shared.unwrap_or_else(|| {
            let executable = Self::create(
                vm,
                length,
                name,
                function,
                constructor,
                intrinsic,
                visibility,
            );
            vm.native_executables.insert(executable);
            executable
        })
    }

    pub(crate) fn hash(&self) -> u64 {
        hash_of_native(self.function, &self.name)
    }

    #[inline(always)]
    pub fn function(&self) -> NativeFunction {
        self.function
    }

    #[inline(always)]
    pub fn constructor(&self) -> NativeFunction {
        self.constructor
    }

    pub fn name(&self) -> &StringRef {
        &self.name
    }

    pub fn length(&self) -> u32 {
        self.length
    }

    pub fn source_text(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        if let Some(text) = self.cached_source_text() {
            return Ok(text);
        }
        let text = native_source_text(cx, crate::anchor!(self).name.text())?;
        self.set_cached_source_text(Some(text));
        Ok(text)
    }

    pub(crate) fn leave_name_out_of_source_text(&self, vm: &Vm) {
        let text = JsString::from_literal(vm, "function () { [native code] }");
        self.set_cached_source_text(Some(text));
    }

    /// Whether scripts see `bound ` in front of the name.
    pub fn is_named_as_bound(&self) -> &Cell<bool> {
        &self.is_named_as_bound
    }
}

#[cell(cell_type = ProgramExecutable..=FunctionExecutable, reconcile_weak_references,
    export = "engine_class_ScriptExecutable")]
pub struct ScriptExecutable {
    base: Executable,
    home: Home,
    rare_data: OnceBox<RareData>,
}

/// A `SourceProviderRef`, or with `INSIDE` the address of the executable that has it.
#[repr(transparent)]
pub struct Home(usize);

impl !GcFree for Home {}

impl Home {
    const INSIDE: usize = 1;

    fn top_level(provider: SourceProviderRef) -> Home {
        Home(provider.into_raw().as_ptr().expose_provenance())
    }

    fn inside(top_level: Gc<ScriptExecutable>) -> Home {
        Home(top_level.address() | Self::INSIDE)
    }

    #[inline]
    fn outside(&self) -> Option<Gc<ScriptExecutable>> {
        // SAFETY: from `inside`, and traced.
        (self.0 & Self::INSIDE != 0).then(|| unsafe { Gc::from_address(self.0 - Self::INSIDE) })
    }

    #[inline]
    fn provider(&self) -> &SourceProviderRef {
        // SAFETY: this keeps the other alive, which is at the top level, so either has the bits of such a reference.
        unsafe {
            let home = (self.outside()).map_or(&raw const *self, |it| &raw const it.home);
            &*home.cast()
        }
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        if self.0 & Self::INSIDE == 0 {
            // SAFETY: from `top_level`.
            unsafe {
                core::ptr::from_mut(self)
                    .cast::<SourceProviderRef>()
                    .drop_in_place()
            }
        }
    }
}

// SAFETY: visits the executable.
unsafe impl Trace for Home {
    #[inline]
    fn trace(&self, visitor: &mut Visitor) {
        match self.outside() {
            Some(top_level) => visitor.append(top_level),
            None => drop(visitor.add_opaque_root(self.provider().opaque_root())),
        }
    }
}

#[derive(Trace)]
struct RareData {
    template_objects: OnceBox<TracedMap<u32, Gc<JsArray>>>,
    evals: OnceBox<TracedMap<EvalKey, Gc<EvalExecutable>>>,
    source_text: Field<Option<Gc<JsString>>>,
    name: OnceCell<StringRef>,
    restrictions: Cell<Restrictions>,
}

impl Default for RareData {
    fn default() -> RareData {
        RareData {
            template_objects: OnceBox::new(),
            evals: OnceBox::new(),
            source_text: Field::new(None),
            name: OnceCell::new(),
            restrictions: Cell::default(),
        }
    }
}

bitflags::bitflags! {
    /// What the optimizer is told to leave undone.
    #[derive(Clone, Copy, Default)]
    pub struct Restrictions: u8 {
        const NEVER_OPTIMIZE = 1 << 0;
        const NEVER_FULLY_OPTIMIZE = 1 << 1;
        const NEVER_INLINE = 1 << 2;
    }
}

impl ScriptExecutable {
    fn init(shape: Gc<Shape>, home: Home) -> ScriptExecutableInit {
        let (call, construct) = (call::link_call_entry(), call::link_construct_entry());
        ScriptExecutableInit {
            base: Executable::init(shape, call, construct),
            home,
            rare_data: OnceBox::new(),
        }
    }

    #[inline]
    pub fn provider(&self) -> &SourceProviderRef {
        self.home.provider()
    }

    /// The text that the positions in the code refer to, which lives no shorter than this.
    pub fn code_provider(&self) -> SourceProviderRef {
        match self.downcast::<FunctionExecutable>() {
            Some(function) if function.is_default_constructor() => {
                (self.heap().vm()).default_constructor_provider(function.info())
            }
            _ => self.provider().clone(),
        }
    }

    /// In that text. Of a function, from the parameters on.
    pub fn code_range(&self) -> core::ops::Range<u32> {
        match self.downcast::<FunctionExecutable>() {
            Some(function) if function.is_default_constructor() => {
                let length = function.info().default_constructor_source().len() - ")".len();
                function.parameters_start()..length as u32
            }
            Some(function) => function.parameters_start()..function.info().range().end,
            None => 0..self.provider().text().len() as u32,
        }
    }

    /// The script, module or `eval` code that this is a part of.
    pub fn top_level(&self) -> Gc<ScriptExecutable> {
        self.home.outside().unwrap_or_else(|| self.into())
    }

    /// Of the top level: by where the template ends.
    pub(crate) fn template_objects(&self) -> Owned<'_, TracedMap<u32, Gc<JsArray>>> {
        let rare_data = self.rare_data.get_or_default();
        // SAFETY: traced with the rare data.
        unsafe { Owned::new(self, rare_data.template_objects.get_or_default()) }
    }

    /// What direct `eval` in this code has compiled.
    pub(super) fn evals(&self) -> Owned<'_, TracedMap<EvalKey, Gc<EvalExecutable>>> {
        // SAFETY: as above.
        unsafe { Owned::new(self, self.rare_data.get_or_default().evals.get_or_default()) }
    }

    pub(super) fn forget_evals(&self) {
        if (self.rare_data.get()).is_some_and(|it| it.evals.get().is_some()) {
            self.evals().clear();
        }
    }

    /// A built-in whose source is not for scripts and tools to see.
    pub fn is_private_builtin(&self) -> bool {
        let function = self.downcast::<FunctionExecutable>();
        function.is_some_and(|it| it.info().origin().contains(Origin::NO_POSITIONS))
    }

    pub fn restrictions(&self) -> Restrictions {
        (self.rare_data.get()).map_or_default(|it| it.restrictions.get())
    }

    pub fn restrict(&self, restrictions: Restrictions) {
        (self.rare_data.get_or_default().restrictions).update(|it| it | restrictions);
    }

    /// The next call links the code again, which may be generated anew: no coroutine is suspended in a function.
    pub(crate) fn clear_code(&self, specialization: Specialization) {
        let entry = match specialization {
            Specialization::Call => call::link_call_entry(),
            Specialization::Construct => call::link_construct_entry(),
        };
        // SAFETY: what it started with.
        unsafe { self.install(specialization, entry, None) }
    }

    /// What the scope of the callee is an instance of.
    pub(crate) fn scope_of_callee(&self) -> Option<Rc<StaticScope>> {
        if let Some(function) = self.downcast::<FunctionExecutable>() {
            function.info().outer_scope().cloned()
        } else if let Some(module) = self.downcast::<ModuleExecutable>() {
            Some(Rc::clone(module.template.scope()))
        } else if let Some(program) = self.downcast::<ProgramExecutable>() {
            program.unit().outer.clone()
        } else {
            (Gc::from(self).cast::<EvalExecutable>().unit().outer).clone()
        }
    }

    pub(crate) fn unlinked_code(
        &self,
        cx: &Cx,
        specialization: Specialization,
    ) -> JsResult<Rc<Code>> {
        if let Some(function) = self.downcast::<FunctionExecutable>() {
            return function.compile(cx, specialization);
        }
        Ok(
            if let Some(program) = self.downcast::<ProgramExecutable>() {
                Rc::clone(&program.unit().code)
            } else if let Some(module) = self.downcast::<ModuleExecutable>() {
                Rc::clone(&module.unit().expect("code that may still run").code)
            } else {
                Rc::clone(&Gc::from(self).cast::<EvalExecutable>().unit().code)
            },
        )
    }
}

macro_rules! top_level_executables {
    ($($name:ident, $init:ident, $shape:ident, $unit:ty;)*) => {$(
        #[cell(cell_type = $name)]
        pub struct $name {
            base: ScriptExecutable,
            range: core::ops::Range<u32>,
            unit: RefCell<Option<Rc<$unit>>>,
        }

        impl $name {
            pub fn create(vm: &Vm, source: &SourceCode, unit: Rc<$unit>) -> Gc<$name> {
                vm.allocate::<$name>($init {
                    base: ScriptExecutable::init(vm.shapes.$shape(), Home::top_level(source.provider.clone())),
                    range: source.range(),
                    unit: RefCell::new(Some(unit)),
                })
            }

            /// Panics once the code is released.
            pub fn unit(&self) -> Rc<$unit> {
                self.unit.borrow().clone().expect("code that may still run")
            }

            /// For code that does not run again. Its functions keep the executable alive.
            pub(crate) fn release_code(&self) {
                self.clear_code(Specialization::Call);
                self.unit.take();
            }

            pub fn range(&self) -> core::ops::Range<u32> {
                self.range.clone()
            }
        }
    )*};
}

top_level_executables! {
    ProgramExecutable, ProgramExecutableInit, program_executable, Script;
    EvalExecutable, EvalExecutableInit, eval_executable, Eval;
}

/// The records of a module in several loaders can have one together.
#[cell(name = "ModuleProgramExecutable", cell_type = ModuleExecutable, export = "engine_class_ModuleExecutable")]
pub struct ModuleExecutable {
    base: ScriptExecutable,
    global: Gc<GlobalObject>,
    template: Gc<ScopeTemplate>,
    unit: RefCell<Option<Rc<Module>>>,
    functions: Rc<[FunctionInfo]>,
    flags: CodeFlags,
    /// By `Slot::function`.
    pub(self) lazy_functions: TracedMap<u32, Gc<FunctionExecutable>>,
    is_shareable: bool,
    is_shared: Cell<bool>,
    unfinished_records: Cell<u32>,
}

impl ModuleExecutable {
    pub fn create(
        cx: &Cx,
        source: &SourceCode,
        unit: Rc<Module>,
        is_shareable: bool,
    ) -> Gc<ModuleExecutable> {
        let shape = cx.shapes.module_executable();
        cx.allocate::<ModuleExecutable>(ModuleExecutableInit {
            base: ScriptExecutable::init(shape, Home::top_level(source.provider.clone())),
            global: cx.global(),
            template: ScopeTemplate::create(cx, Rc::clone(&unit.scope)),
            functions: Rc::clone(&unit.code.functions),
            flags: unit.code.body.flags(),
            unit: RefCell::new(Some(unit)),
            is_shareable,
            is_shared: Cell::new(false),
            unfinished_records: Cell::new(1),
        })
    }

    pub fn global(&self) -> Gc<GlobalObject> {
        self.global
    }

    /// Of the environments that the code runs in.
    pub fn template(&self) -> Gc<ScopeTemplate> {
        self.template
    }

    pub fn flags(&self) -> CodeFlags {
        self.flags
    }

    /// `None` once the code is released.
    pub fn unit(&self) -> Option<Rc<Module>> {
        self.unit.borrow().clone()
    }

    /// If not, all code in the module runs in the one environment.
    pub fn is_shareable(&self) -> bool {
        self.is_shareable
    }

    /// For another record. False if `unit` is not what this was made from.
    pub(crate) fn share(&self, unit: &Rc<Module>) -> bool {
        if !self.is_shareable || !Rc::ptr_eq(&unit.scope, self.template.scope()) {
            return false;
        }
        self.unit.replace(Some(Rc::clone(unit)));
        self.is_shared.set(true);
        self.unfinished_records.update(|count| count + 1);
        true
    }

    /// One of the records does not run the code any more. What has been shared is likely to be shared again.
    pub(crate) fn did_finish_evaluation(&self) {
        self.unfinished_records.update(|count| count - 1);
        if self.unfinished_records.get() == 0 && !self.is_shared.get() {
            self.clear_code(Specialization::Call);
            if !self.is_shareable {
                self.unit.take();
            }
        }
    }

    /// The next loader compiles the module anew.
    pub(super) fn discard_unit_unless_needed(&self) {
        if self.unfinished_records.get() == 0 {
            self.unit.take();
        }
    }

    pub(crate) fn lazy_function(&self, vm: &Vm, index: u32) -> Gc<FunctionExecutable> {
        self.lazy_functions().get(&index).unwrap_or_else(|| {
            let info = FunctionRef::new(Rc::clone(&self.functions), index);
            let executable = FunctionExecutable::create_inside(vm, self, info);
            if self.is_shareable {
                self.lazy_functions().insert(index, executable);
            }
            executable
        })
    }
}

#[cell(cell_type = FunctionExecutable, export = "engine_class_FunctionExecutable")]
pub struct FunctionExecutable {
    base: ScriptExecutable,
    table: Rc<[FunctionInfo]>,
    index: u32,
    shape_slot: RealmSlot,
    intrinsic: Cell<Intrinsic>,
    /// Valid while at most one function has been made from this.
    singleton_watchpoints: InlineWatchpointSet,
    pub(self) first_function: WeakField<Option<Gc<JsFunction>>>,
}

const _: () = assert!(size_of::<FunctionExecutable>() == 96);

impl FunctionExecutable {
    pub const OFFSET_OF_SINGLETON_WATCHPOINTS: usize =
        offset_of!(FunctionExecutable, singleton_watchpoints);

    /// For a function that is a part of no other code.
    pub fn create(
        vm: &Vm,
        provider: SourceProviderRef,
        function: FunctionRef,
    ) -> Gc<FunctionExecutable> {
        Self::create_at(vm, Home::top_level(provider), function)
    }

    /// For a function in the same text as `outer`.
    pub(super) fn create_inside(
        vm: &Vm,
        outer: &ScriptExecutable,
        function: FunctionRef,
    ) -> Gc<FunctionExecutable> {
        Self::create_at(vm, Home::inside(outer.top_level()), function)
    }

    /// See `FunctionInfo::moved_to`.
    pub(super) fn moved_to(&self, vm: &Vm, scope: Rc<StaticScope>) -> Gc<FunctionExecutable> {
        let function = self.info().moved_to(scope, self.provider().text());
        Self::create_inside(vm, self, function)
    }

    #[inline(always)]
    fn create_at(vm: &Vm, home: Home, function: FunctionRef) -> Gc<FunctionExecutable> {
        let shape_slot = Self::shape_slot_for(&function);
        let (table, index) = function.into_parts();
        vm.allocate::<FunctionExecutable>(FunctionExecutableInit {
            base: ScriptExecutable::init(vm.shapes.function_executable(), home),
            table,
            index,
            shape_slot,
            intrinsic: Cell::new(Intrinsic::None),
            singleton_watchpoints: InlineWatchpointSet::new(WatchpointState::Clear),
            first_function: None,
        })
    }

    pub fn shape_slot_for(info: &FunctionInfo) -> RealmSlot {
        match (info.is_async(), info.is_generator()) {
            (true, true) => RealmSlot::async_generator_function_shape,
            (true, false) => RealmSlot::async_function_shape,
            (false, true) => RealmSlot::generator_function_shape,
            _ if info.origin().contains(Origin::BUILTIN) => RealmSlot::builtin_function_shape,
            _ if info.kind() == FunctionKind::Normal || info.kind().is_class_constructor() => {
                RealmSlot::function_shape
            }
            _ => RealmSlot::method_shape,
        }
    }

    /// Where a realm has the shape of the functions that are made from this.
    #[inline(always)]
    pub fn shape_slot(&self) -> RealmSlot {
        self.shape_slot
    }

    #[inline(always)]
    pub fn info(&self) -> &FunctionInfo {
        &self.table[self.index as usize]
    }

    pub(super) fn place_in_table(&self) -> (&Rc<[FunctionInfo]>, u32) {
        (&self.table, self.index)
    }

    pub fn set_intrinsic(&self, intrinsic: Intrinsic) {
        self.intrinsic.set(intrinsic);
    }

    #[inline]
    pub fn is_builtin(&self) -> bool {
        self.info().origin().contains(Origin::BUILTIN)
    }

    pub fn has_prototype_property(&self) -> bool {
        self.info().is_generator()
            || (self.info().kind() == FunctionKind::Normal && !self.info().is_async())
            || self.info().kind().is_class_constructor()
    }

    pub fn name_text(&self) -> Text<'_> {
        self.info().name_text(self.provider().text())
    }

    /// What SetFunctionName gets, without the prefix. Allocates nothing in the heap.
    pub fn name(&self) -> &StringRef {
        self.rare_data.get_or_default().name.get_or_init(|| {
            let name = self.name_text();
            if name == names::starDefaultText.text() && !self.info().has_own_name() {
                return names::default.to_identifier().into_string();
            }
            StringRef::from_text(name)
        })
    }

    fn is_default_constructor(&self) -> bool {
        self.info().origin().contains(Origin::DEFAULT_CONSTRUCTOR)
    }

    /// In the text of `code_provider`.
    pub fn parameters_start(&self) -> u32 {
        if self.is_default_constructor() {
            return "(function ".len() as u32;
        }
        self.info().parameters_start()
    }

    #[inline(always)]
    pub(crate) fn did_create(&self, vm: &Vm, function: Gc<JsFunction>) {
        if self.singleton_watchpoints.is_still_valid() {
            self.did_create_slow(vm, function);
        }
    }

    #[inline(never)]
    fn did_create_slow(&self, vm: &Vm, function: Gc<JsFunction>) {
        let is_first = self.singleton_watchpoints.state() == WatchpointState::Clear;
        self.set_first_function(is_first.then_some(function));
        self.singleton_watchpoints.touch(vm);
    }

    pub fn singleton(&self) -> Option<Gc<JsFunction>> {
        self.first_function()
    }

    #[inline(always)]
    pub fn singleton_watchpoints(&self) -> &InlineWatchpointSet {
        &self.singleton_watchpoints
    }

    pub fn source_text(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        if let Some(text) = self.rare_data.get().and_then(|it| it.source_text.get()) {
            return Ok(text);
        }
        let text = if self.is_private_builtin() {
            native_source_text(cx, crate::anchor!(self).name_text())?
        } else {
            let range = self.info().text_range();
            let range = range.start as usize..range.end as usize;
            JsString::new(cx, StringRef::substring(self.provider().source(), range))
        };
        let rare_data = self.rare_data.get_or_default();
        // SAFETY: traced with the rare data.
        unsafe { rare_data.source_text.set(self, Some(text)) };
        Ok(text)
    }
}

/// NativeFunction of ECMA-262.
pub fn native_source_text(cx: &Cx, name: Text<'_>) -> JsResult<Gc<JsString>> {
    let (before, after) = ("function ", "() { [native code] }");
    cx.new_string_from_parts(&[Text::from_ascii(before), name, Text::from_ascii(after)])
}
