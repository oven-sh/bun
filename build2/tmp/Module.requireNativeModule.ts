// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/Module.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(id) {  let esm = Loader.registry.__intrinsic__get(id);
  if (esm?.evaluated && (esm.state ?? 0) >= __intrinsic__ModuleReady) {
    const exports = Loader.getModuleNamespaceObject(esm.module);
    return exports.default;
  }
  return __intrinsic__requireESM(id).default;
}).$$capture_end$$;
