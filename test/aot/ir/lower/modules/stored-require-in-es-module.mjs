// RUN(HEAD): lower
// HEAD: function {{*}}kind=Module
// HEAD: [[meta]] = ModuleBuiltin builtin=ImportMeta
// HEAD: [[own]] = PropGet [[meta]] key="require"
// HEAD: PutModuleVariable [[own]]

// RUN(STORE): lower
// STORE-LABEL: function {{*}}name="store"
// STORE-NOT: PropSet
// STORE: PutModuleVariable
// STORE: Return

// RUN(LOAD): lower
// LOAD-LABEL: function {{*}}name="load"
// LOAD: = GetModuleVariable
// LOAD: [[own]] = ModuleBuiltin builtin=ModuleRequire
// LOAD: [[same]] = StrictEq {{*}}, [[own]]
// LOAD: Branch [[same]]
// LOAD: = RequireModule {{*}}specifier="node:path"
// LOAD: = Call {{*}}calleeName="require"

// RUN(READ): lower
// READ-LABEL: function {{*}}name="read"
// READ-NOT: ModuleBuiltin
// READ: = GetModuleVariable
// READ: Return

export function store(loader) {
  require = loader;
}

export function load() {
  return require("node:path");
}

export function read() {
  return require;
}
