// RUN: lower
// CHECK-LABEL: function {{*}}name="meta"
// CHECK: [[meta]] = ModuleBuiltin builtin=ImportMeta module=m
// CHECK-NEXT: Return [[meta]]

// RUN(STORE): lower
// STORE-LABEL: function {{*}}name="store"
// STORE: [[meta]] = ModuleBuiltin builtin=ImportMeta module=m
// STORE: PropSet [[meta]]{{*}}key="require"
// STORE: Return

// RUN(GLOBAL): lower
// GLOBAL-NOT: GlobalThis

export function meta() {
  return import.meta;
}

export function store(loader) {
  import.meta.require = loader;
}
