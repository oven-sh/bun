// Three CommonJS modules. Each is required at the top level of the one before it, outside every function and every `try`. All three bodies call something, so each of them can throw, but no code would run after such a failure and require the module again: each body runs at most once, and a symbol made at the top of one is the same symbol wherever it is used. commonjs/what-a-failed-run-let-out and commonjs/symbols-of-failed-module-body have the bodies that do run twice.
const { Box, kState, kBare, stateOf } = require("./keys.cjs");
const again = require("./keys.cjs");
function readHere(box) { return box[kState]; }
function storeHere(box, value) { box[kState] = value; return box; }

const first = new Box(), second = new Box();
console.log("states:", first.state, second.state, first[kState], second[again.kState], stateOf(second), readHere(first));
console.log("own symbols:", Object.getOwnPropertySymbols(new Box()).length, Object.getOwnPropertySymbols(first)[0] === kState, Object.getOwnPropertySymbols(first)[1] === kBare);
console.log("own names:", Object.keys(first).length, JSON.stringify(first));
console.log("descriptions:", kState.description, String(kState), typeof kState, kBare.description, String(kBare));
console.log("two requires:", again.kState === kState, again.kBare === kBare, again.Box === Box, again === require("./keys.cjs"));
console.log("no two alike:", kState === kBare, kState === Symbol("state"), kState === Symbol.for("state"), Symbol.keyFor(kState));

let total = 0;
for (let i = 0; i < 300; i++) {
  const box = new Box();
  total += box.state + readHere(box) + stateOf(box);
}
console.log("total:", total);

console.log("stored from here:", storeHere(first, "stored").state, stateOf(first), second.state);
console.log("present:", kState in first, kState in {}, Object.hasOwn(first, kState), Object.hasOwn(Box.prototype, kState), readHere({}), readHere(Object.create(first)));
console.log("under a key that is handed over:", [kState, kBare, "state"].map(key => String(first[key])).join());
console.log("deleted:", delete first[kState], first.state, Object.getOwnPropertySymbols(first).length);
