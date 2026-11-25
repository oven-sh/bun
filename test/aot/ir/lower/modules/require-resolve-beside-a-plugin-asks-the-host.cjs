// RUN: lower
// CHECK-LABEL: function {{*}}name="resolveAll"
// CHECK-COUNT-3: = ResolveDynamic
// CHECK-NOT: = ResolveDynamic
// CHECK-NOT: SwitchString

// `bun build` leaves every call of `require.resolve` to the run time, where a plugin may answer it. The program names `Bun.plugin`, so the resolver of the host is asked, which asks the plugins first.
Bun.plugin({ name: "none", setup() {} });
function resolveAll(flag) {
  const pick = flag ? "./imports/resolved/b.cjs" : "./imports/resolved/a.cjs";
  const one = "./imports/resolved/a.cjs";
  return [require.resolve(pick), require.resolve(one), require.resolve("./imports/resolved/a.cjs")];
}
console.log(resolveAll(false));
