const unseen = (0, eval)("(x) => x");
const t = (name, f) => { try { f(); console.log(name, "no error"); } catch (e) { console.log(name, JSON.stringify(e.message)); } };
for (const [name, parent] of [["an object", {}], ["an arrow", () => {}], ["a method", { m() {} }.m], ["a native function", Math.max], ["an async function", async function () {}], ["a generator", function* () {}], ["a bound arrow", (() => {}).bind(null)], ["a proxy of an object", new Proxy({}, {})]]) {
  class Child extends Object { constructor(x) { super(x); } }
  Object.setPrototypeOf(Child, unseen(parent));
  t(name, () => new Child(1));
}
for (const [name, parent] of [["an object", {}], ["an arrow", () => {}], ["a method", { m() {} }.m], ["an async function", async function () {}], ["a proxy of an object", new Proxy({}, {})]]) {
  class Kid extends Object {}
  Object.setPrototypeOf(Kid, unseen(parent));
  t(name + ", no constructor", () => new Kid(1));
}
