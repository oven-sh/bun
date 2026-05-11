//! Thin façade over the `oxc_react_compiler` crate (a Rust port of
//! `babel-plugin-react-compiler` on OXC's toolchain).
//!
//! Bun's bundler calls [`compile`] as a source-to-source pre-parse pass: the
//! transformed text is then fed to `bun_js_parser` exactly as if it had come
//! from disk. Keeping the integration at the string level means the OXC AST
//! never crosses into Bun's own `bun_ast` — the two are entirely separate
//! representations and attempting to bridge them would be a port of its own.
//!
//! The wrapper is intentionally minimal: it hides every `oxc_*` type behind a
//! single free function so `bun_bundler`'s `Cargo.toml` only names this crate,
//! and so the React-Compiler-specific option surface (`CompilationMode`,
//! `PanicThreshold`, the ~40-field `EnvironmentConfig`) can grow here without
//! touching bundler code.
//!
//! See `src/react_compiler/Cargo.toml` for source-map / resolve caveats.

use oxc_react_compiler::options::{CompilationMode, PanicThreshold, PluginOptions};

/// User-facing knobs that Bun surfaces today. Grow this alongside
/// `--react-compiler-*` CLI flags / the `reactCompiler` JS option object;
/// everything not listed here falls through to
/// `oxc_react_compiler::options::PluginOptions::default()`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    /// Map of Bun's flag to upstream `CompilationMode`. `None` → `Infer`.
    pub compilation_mode: Mode,
}

/// Mirrors `oxc_react_compiler::options::CompilationMode` without leaking the
/// foreign type into `bun_bundler`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    /// Compile functions that look like components/hooks (upstream default).
    #[default]
    Infer,
    /// Compile only functions carrying `"use memo"`.
    Annotation,
    /// Compile every top-level function.
    All,
}

impl From<Mode> for CompilationMode {
    fn from(m: Mode) -> Self {
        match m {
            Mode::Infer => CompilationMode::Infer,
            Mode::Annotation => CompilationMode::Annotation,
            Mode::All => CompilationMode::All,
        }
    }
}

/// Run the React Compiler over `source`.
///
/// Returns `Some(transformed_bytes)` if the compiler rewrote anything,
/// `None` if it left the file untouched (no components/hooks found, an
/// opt-out directive was present, or the compiler bailed). The bundler treats
/// `None` as "use the original bytes unchanged".
///
/// `source` is `&[u8]` because that is what `cache::Contents::as_slice()`
/// yields. Non-UTF-8 input is passed through untouched — the React Compiler
/// is a JS-level semantic transform, and Bun's own parser will surface the
/// real diagnostic on the original bytes.
///
/// `path` is used only for the compiler's own diagnostics; it does not read
/// the filesystem.
pub fn compile(path: &str, source: &[u8], options: Options) -> Option<Vec<u8>> {
    // React source is JS/TS text — if it isn't UTF-8 the compiler cannot
    // reason about it anyway. Fall through silently; Bun's parser reports
    // the syntax error against the original bytes.
    let source = core::str::from_utf8(source).ok()?;

    let plugin_options = PluginOptions {
        compilation_mode: options.compilation_mode.into(),
        // Never panic out of the compiler — on any internal error it should
        // bail and hand back the original source. Matches the Babel plugin's
        // production default.
        panic_threshold: PanicThreshold::None,
        // TODO(react-compiler): compound source maps. Disabled so the compiler
        // does not waste time building a map we immediately drop; see the
        // crate-level Cargo.toml note.
        source_map: false,
        ..PluginOptions::default()
    };

    let result = oxc_react_compiler::compile(path, source, &plugin_options);
    if result.transformed {
        Some(result.code.into_bytes())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A component that calls a hook must be rewritten to use the memo cache
    /// (`_c(n)` / `useMemoCache`) — this is the React Compiler's signature.
    #[test]
    fn transforms_component_with_hook() {
        let src = br#"
import { useState } from 'react';
export function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
"#;
        let out = compile("Counter.jsx", src, Options::default())
            .expect("component with hook should be transformed");
        let out = String::from_utf8(out).unwrap();
        // The compiler injects a call to the memo-cache hook (named `_c` in
        // upstream output) and imports it from `react/compiler-runtime`.
        assert!(
            out.contains("_c(") || out.contains("useMemoCache"),
            "expected memo-cache call in output, got:\n{out}"
        );
        assert!(
            out.contains("react/compiler-runtime") || out.contains("react-compiler-runtime"),
            "expected compiler-runtime import in output, got:\n{out}"
        );
    }

    /// Plain functions (not components, not hooks) are left alone so the
    /// bundler can reuse the original bytes.
    #[test]
    fn passes_through_non_component() {
        let src = b"export function add(a, b) { return a + b; }\n";
        assert!(compile("math.js", src, Options::default()).is_none());
    }

    /// Non-UTF-8 input must not panic; it falls through to Bun's own parser.
    #[test]
    fn passes_through_non_utf8() {
        let src = b"const x = '\xff\xfe';";
        assert!(compile("bad.jsx", src, Options::default()).is_none());
    }
}
