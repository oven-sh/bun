//! What a rule sees of the project's installed Svelte compiler: eslint-plugin-svelte's `getSvelteCompileWarnings`. The
//! compiler and the transforms that run before it are JavaScript, which the file's linter runs if the config has loaded
//! eslint-plugin-svelte: [`File::svelte_compiler`].
//!
//! Ports parts of eslint-plugin-svelte, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use crate::ast::File;
use crate::options::Json;

/// `svelte/compiler`'s result for a component.
pub enum Compiled {
    /// `{ kind, version, stripped, warnings }`, as `compileSvelte` in `worker/svelte.js` returns it.
    Answer(Json),
    /// There's no `svelte/compiler` where eslint-plugin-svelte would import it from.
    NotInstalled,
    /// The realm failed, with this message.
    Failed(Vec<u8>),
}

pub trait SvelteCompiler: Sync {
    /// `request` is JSON, as `compileSvelte` reads it. `text` is the component, without a byte order mark.
    fn compile(&self, request: &[u8], text: &[u8]) -> Compiled;
}

/// The compiler, for one component.
#[derive(Copy, Clone)]
pub struct Compiler<'a> {
    pub compiles: &'a dyn SvelteCompiler,
    /// The eslint-plugin-svelte module the config has loaded.
    pub plugin: &'a [u8],
    /// ESLint's `filename`, absolute.
    pub filename: &'a [u8],
    /// JSON: the Svelte config's `compilerOptions.experimental.async`, or `null`.
    pub experimental_async: &'a [u8],
    /// JSON: the parser options' `project`, `projectService`, `tsconfigRootDir`, `extraFileExtensions` and
    /// `projectFolderIgnoreList`, from which typescript-eslint creates the program whose `target` TypeScript is
    /// compiled to, or `null` if the scripts' parser creates none.
    pub program: &'a [u8],
}

impl<'a> File<'a> {
    /// `None` if nothing provides one.
    #[inline]
    pub fn svelte_compiler(&self) -> Option<Compiler<'a>> {
        self.svelte_compiler.get()
    }

    pub fn set_svelte_compiler(&self, compiler: &Compiler<'a>) {
        self.svelte_compiler.set(Some(*compiler));
    }
}
