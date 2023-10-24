// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ImportMetaObject.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(resolved) {  var entry = Loader.registry.__intrinsic__get(resolved);

  if (!entry || !entry.evaluated) {
    entry = __intrinsic__loadCJS2ESM(resolved);
  }

  if (!entry || !entry.evaluated || !entry.module) {
    __intrinsic__throwTypeError(`require() failed to evaluate module "${resolved}". This is an internal consistentency error.`);
  }
  var exports = Loader.getModuleNamespaceObject(entry.module);

  return exports;
}).$$capture_end$$;
