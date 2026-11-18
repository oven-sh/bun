//! A valid module and its code.

use core::any::Any;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use bun_engine_wasm_compiler::abi::{GlobalPlace, InstanceLayout, MemoryMode, Signature};
use bun_engine_wasm_format::{
    CompileOptions, Error, FuncIndex, GlobalIndex, OutOfMemory, Provided,
};

use crate::alloc::try_defaults;
use crate::code::CodeGroup;
use crate::engine::Engine;

pub struct Module {
    engine: &'static Engine,
    contents: bun_engine_wasm_format::Module,
    layout: InstanceLayout,
    /// The offsets in an instance of the globals that hold references.
    inline_references: Box<[i32]>,
    /// By type, for calls between the host and WebAssembly.
    signatures: Box<[OnceLock<Box<Signature>>]>,
    /// By import.
    provided: OnceLock<Box<[Option<Provided>]>>,
    /// Of all that has been generated.
    code_bytes: AtomicUsize,
    guarded: OnceLock<CodeGroup>,
    checked: OnceLock<CodeGroup>,
    interpreted: OnceLock<Box<dyn Any + Send + Sync>>,
}

impl core::ops::Deref for Module {
    type Target = bun_engine_wasm_format::Module;

    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.contents
    }
}

impl Module {
    pub(crate) fn new(
        engine: &'static Engine,
        contents: bun_engine_wasm_format::Module,
    ) -> Result<Arc<Self>, OutOfMemory> {
        let layout = InstanceLayout::new(&contents, engine.layout());
        let globals = contents.globals().iter().zip(0..);
        let references = globals.filter(|(global, _)| global.ty.is_ref());
        let inline_references = references
            .filter_map(|(_, index)| match layout.global(GlobalIndex(index)) {
                GlobalPlace::Inline(offset) => Some(offset),
                GlobalPlace::Indirect(_) => None,
            })
            .collect();
        Ok(Arc::new(Self {
            engine,
            layout,
            inline_references,
            signatures: try_defaults(contents.types().len() as usize)?,
            contents,
            provided: OnceLock::new(),
            code_bytes: AtomicUsize::new(0),
            guarded: OnceLock::new(),
            checked: OnceLock::new(),
            interpreted: OnceLock::new(),
        }))
    }

    #[inline]
    pub fn engine(&self) -> &'static Engine {
        self.engine
    }

    #[inline]
    pub fn layout(&self) -> &InstanceLayout {
        &self.layout
    }

    /// For what an interpreter makes of the functions.
    #[inline]
    pub fn interpreted(&self) -> &OnceLock<Box<dyn Any + Send + Sync>> {
        &self.interpreted
    }

    /// Once, before anything else sees the module. An error makes it invalid.
    pub fn apply_options(&self, options: CompileOptions<'_>) -> Result<(), Error> {
        let provided = self.provided_imports(options)?;
        assert!(self.provided.set(provided).is_ok());
        Ok(())
    }

    /// What takes the place of the import with that index.
    pub fn provided_import(&self, index: usize) -> Option<Provided> {
        self.provided.get()?[index]
    }

    /// About what it takes, in bytes. It never falls.
    pub fn footprint(&self) -> usize {
        self.size_in_bytes() + self.code_bytes.load(Ordering::Relaxed)
    }

    pub(crate) fn did_make_code(&self, bytes: usize) {
        self.code_bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    pub(crate) fn inline_references(&self) -> &[i32] {
        &self.inline_references
    }

    pub(crate) fn signature(&self, func: FuncIndex) -> &Signature {
        let ty = self.func_type_index(func);
        let make = || Box::new(Signature::new(self.types().func_type(ty)));
        self.signatures[ty.usize()].get_or_init(make)
    }

    fn group(&self, mode: MemoryMode) -> &OnceLock<CodeGroup> {
        match mode {
            MemoryMode::Guarded => &self.guarded,
            MemoryMode::Checked => &self.checked,
        }
    }

    pub(crate) fn make_code(&self, mode: MemoryMode) -> Result<&CodeGroup, OutOfMemory> {
        if let Some(group) = self.group(mode).get() {
            return Ok(group);
        }
        let group = CodeGroup::new(self, mode)?;
        Ok(self.group(mode).get_or_init(|| group))
    }

    /// After `make_code`.
    #[inline]
    pub(crate) fn code(&self, mode: MemoryMode) -> &CodeGroup {
        self.group(mode).get().expect("an instance asked for it")
    }
}
