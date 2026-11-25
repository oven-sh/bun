// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="loadAll"
// CHECK-COUNT-3: = ImportDynamic
// CHECK-NOT: = ImportDynamic
// CHECK-COUNT-2: = ImportModule
// CHECK-NOT: = ImportDynamic

// `bun build` links no module of the library, and the loader asks the plugins about a name with a namespace in front before it knows the name. The program names `Bun.plugin`:
// the choice, the constant and `bun:jsc` are left to the loader. A bare `os` the loader knows at once, and for `node:os` written out `bun build` prints `os`: those two stay linked.
Bun.plugin({ name: "none", setup() {} });
async function loadAll(flag) {
  const pick = flag ? "node:path" : "node:os";
  const one = "node:os";
  const bare = "os";
  return [await import(pick), await import(one), await import("bun:jsc"), await import(bare), await import("node:os")];
}
console.log(await loadAll(false));
