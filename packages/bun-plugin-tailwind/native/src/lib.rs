//! The native half of `bun-plugin-tailwind`: scans the modules that Bun's bundler parses for
//! Tailwind class candidates, on the bundler's threads, without a round trip through JavaScript.

use std::path::Path;
use std::sync::{LazyLock, Mutex, PoisonError};

use bun_native_plugin::{anyhow, bun, define_bun_plugin, Result};
use napi::bindgen_prelude::{External, ExternalRef};
use napi::{Env, Result as NapiResult};
use napi_derive::napi;
use rustc_hash::{FxHashMap, FxHashSet};
use tailwindcss_oxide::extractor::{Extracted, Extractor};
use tailwindcss_oxide::scanner::auto_source_detection::BINARY_EXTENSIONS_GLOB;
use tailwindcss_oxide::scanner::pre_process_input;

define_bun_plugin!("tailwindcss");

/// The extensions that Tailwind's scan of the disk skips, out of `*.{png,jpg,…}`.
static BINARY_EXTENSIONS: LazyLock<FxHashSet<&str>> = LazyLock::new(|| {
  BINARY_EXTENSIONS_GLOB
    .trim_start_matches("*.{")
    .trim_end_matches('}')
    .split(',')
    .collect()
});

/// JavaScript holds it as a napi external and hands it to `onBeforeParse`, so the JavaScript
/// thread and the bundler's threads reach it at the same time.
#[derive(Default)]
pub struct TailwindContext {
  /// The candidates of each module, by its path with `/` separators.
  modules: Mutex<FxHashMap<String, FxHashSet<String>>>,
}

#[napi]
pub fn twctx_create(env: &Env) -> NapiResult<ExternalRef<TailwindContext>> {
  ExternalRef::new(env, TailwindContext::default())
}

/// The distinct candidates of the modules inside `directory`, if there is one, that no pattern of
/// `excluded` covers: a directory, or a glob. All are absolute paths with `/` separators.
#[napi]
pub fn twctx_candidates(
  ctx: ExternalRef<TailwindContext>,
  directory: Option<String>,
  excluded: Vec<String>,
) -> Vec<String> {
  let is_inside = |id: &str, directory: &str| {
    id.strip_prefix(directory)
      .is_some_and(|rest| rest.starts_with('/'))
  };
  let modules = ctx.modules.lock().unwrap_or_else(PoisonError::into_inner);
  let mut candidates = FxHashSet::<&str>::default();
  for (id, found) in modules.iter() {
    if directory
      .as_deref()
      .is_none_or(|directory| is_inside(id, directory))
      && !excluded
        .iter()
        .any(|pattern| is_inside(id, pattern) || fast_glob::glob_match(pattern, id))
    {
      candidates.extend(found.iter().map(String::as_str));
    }
  }
  candidates.into_iter().map(str::to_owned).collect()
}

/// Runs for every module that matches the filter of `onBeforeParse` in `src/index.ts`, possibly
/// on several bundler threads at once. It only reads the module: source and loader stay as they are.
#[bun]
pub fn tw_on_before_parse(handle: &mut OnBeforeParse) -> Result<()> {
  let path = handle.path()?;
  let extension = Path::new(path.as_ref())
    .extension()
    .and_then(|extension| extension.to_str())
    .unwrap_or_default();
  if BINARY_EXTENSIONS.contains(extension.to_ascii_lowercase().as_str()) {
    return Ok(());
  }
  // Bun reports a module that cannot be read itself.
  let Ok(source) = handle.input_source_code() else {
    return Ok(());
  };

  let source = pre_process_input(source.into_owned().into_bytes(), extension);
  let mut candidates = FxHashSet::default();
  for line in source.split(|byte| *byte == b'\n') {
    for Extracted::Candidate(found) | Extracted::CssVariable(found) in
      Extractor::new(line).extract()
    {
      candidates.insert(String::from_utf8_lossy(found).into_owned());
    }
  }

  // SAFETY: `src/index.ts` passes the external that `twctx_create` made, and keeps it alive for as
  // long as the plugin is registered.
  let ctx: &TailwindContext =
    unsafe { handle.external(External::inner_from_raw) }?.ok_or_else(|| {
      anyhow::anyhow!("bun-plugin-tailwind: onBeforeParse was registered without its context")
    })?;
  ctx
    .modules
    .lock()
    .unwrap_or_else(PoisonError::into_inner)
    .insert(path.replace('\\', "/"), candidates);
  Ok(())
}
