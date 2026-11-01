// A member of a cycle is imported after the root of the cycle threw behind an await.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
const seen = (what, promise) =>
  promise.then(
    () => console.log(`${what} resolves`),
    error => console.log(`${what} rejects ${String(error)}`),
  );
await seen("import(a)", import("./a.mjs"));
await seen("import(b)", import("./b.mjs"));
await seen("import(a) again", import("./a.mjs"));
// Three members, and the one that throws is not the root.
await seen("import(c)", import("./c.mjs"));
await seen("import(d)", import("./d.mjs"));
await seen("import(e)", import("./e.mjs"));
// The awaited promise is rejected.
await seen("import(f)", import("./f.mjs"));
await seen("import(g)", import("./g.mjs"));
// The other member is required, and imported by a later graph.
try {
  console.log("require(b)", Object.keys(require("./b.mjs")).join(" "));
} catch (error) {
  console.log(`require(b) throws ${String(error)}`);
}
await seen("import(over b)", import("./over-b.mjs"));
// The root still waits when the other member is imported.
let release;
globalThis.gate = new Promise(resolve => (release = resolve));
const order = [];
const root = import("./h.mjs").then(() => order.push("h"));
let turns = Promise.resolve();
for (let turn = 1; turn <= 20; turn++) turns = turns.then(() => {});
await turns;
const member = import("./i.mjs").then(() => order.push("i"));
turns = Promise.resolve();
for (let turn = 1; turn <= 20; turn++) turns = turns.then(() => {});
await turns;
order.push("released");
release();
await root;
await member;
console.log(order.join(" "));
await seen("import(i) again", import("./i.mjs"));
