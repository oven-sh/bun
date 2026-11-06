// RUN(TYPEOF): lower
// TYPEOF-LABEL: function {{*}}name="typeOfModule"
// TYPEOF: = PropGet {{*}}key="module" [isFreeName, isForTypeOf]
// TYPEOF: Return

// RUN(FREE): lower
// FREE-LABEL: function {{*}}name="readExports"
// FREE: = PropGet {{*}}key="exports" [isFreeName]
// FREE: Return

// RUN(META): lower
// META-LABEL: function {{*}}name="readOthers"
// META-NOT: isFreeName
// META: = ModuleBuiltin
// META: = String string="{{*}}commonjs-names-in-es-module.js"
// META: = String string="{{*}}modules"
// META-NOT: isFreeName
// META: Return

// RUN(STORE): lower
// STORE-LABEL: function {{*}}name="store"
// STORE: [[meta]] = ModuleBuiltin builtin=ImportMeta
// STORE: PropSet [[meta]]{{*}}key="require"
// STORE: Return

// RUN(KIND): lower
// KIND-NOT: kind=CommonJsModule

export function typeOfModule() {
  return typeof module;
}

export function readExports() {
  return exports;
}

export function readOthers() {
  return [require, __filename, __dirname];
}

export function store(loader) {
  require = loader;
}
