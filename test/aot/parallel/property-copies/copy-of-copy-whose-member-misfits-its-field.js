// A copy takes a string under a name that other literals of its shape give a number, and a second copy is made of the first and returned.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function f94() {
  let v2 = { b94: 1.5 };
  Object.entries(v2).map((p) => p[0]).join();
}
f94();
function f95() {
  let v0 = { c95: 1, a95: 7 }, v1 = { a95: void 0, c95: 7 }, v2 = { c95: { c95: -0 }, b95: { c95: 2.5 } };
  const make = (x) => ({ d95: x, a95: "made" });
  v2 = make(1.5);
  JSON.stringify(v1, (key, x) => x);
  v0 = { ...v2, c95: 7 };
  v2 = { b95: 1.5, ...v0 };
  v0 = make("");
  return v2;
}
const r = f95(); console.log(Object.keys(r).join(), Object.values(r).join());
