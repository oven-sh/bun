// DIAGNOSTIC: TS100151 1
// RUN: lower
// CHECK-LABEL: function {{*}}name="load"
// CHECK: [[name]] = String string="virtual:thing"
// CHECK: = ImportDynamic [[name]]

// Where `bun build` finds nothing it links nothing: the call runs as it is written, and a plugin may answer. The program names `Bun.plugin`, so the build warns and the call throws no failure of the build.
Bun.plugin({ name: "none", setup() {} });
function load() {
  return import("virtual:thing");
}
load().catch(() => {});
