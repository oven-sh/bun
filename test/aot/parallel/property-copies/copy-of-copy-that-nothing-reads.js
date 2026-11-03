// Two copies by spread, the second of the first, whose member "a95" does not fit the field of its shape. Nothing reads the copies.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function f94() {
  let v2 = { b94: 1.5 };
  const write = (o, x) => {
  };
  Object.entries(v2).map((p) => p[0]).join();
}
f94();
function f95() {
  let v0 = { c95: 1, a95: 7 }, v1 = { a95: void 0, c95: 7 }, v2 = { c95: { c95: -0 }, b95: { c95: 2.5 } };
  const write = (o, x) => {
  }, make = (x) => ({ d95: x, a95: "made" });
  v2 = make(1.5);
  JSON.stringify(v1, (key, x) => x);
  v0 = { ...v2, c95: 7 };
  v2 = { b95: 1.5, ...v0 };
  v0 = make("");
}
f95();
console.log("done");
