var foo = true;
globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT = true;
if (globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT)
  ({ foo } = { foo: false });
var foo;
export function test() {
  console.assert(foo === false, "foo should be false");
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/multiple-var.js.map
