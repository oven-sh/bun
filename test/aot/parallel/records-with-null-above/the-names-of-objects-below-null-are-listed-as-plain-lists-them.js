// COUNTER: operationAOTGetPropertyEnumerator <= 60
"use strict";
const hide = (v) => [v][JSON.parse("0")];
const names = (o) => { const seen = []; for (const k in o) seen.push(k + "=" + o[k]); return seen.join(); };

function bare(i) { return { __proto__: null, a: i, b: 2, c: 3 }; }
function plain(i) { return { a: i, b: 2, c: 3 }; }
let text = "";
for (let i = 0; i < 400; i++) text = names(bare(i));
console.log("bare", text);
for (let i = 0; i < 400; i++) text = names(i & 1 ? bare(i) : plain(i)) + "|" + names(i & 1 ? plain(i) : bare(i));
console.log("in turns", text);

const above = { up: "above", more: "too" };
const given = bare(1), other = bare(2);
console.log("before", names(given), "|", names(other));
Object.setPrototypeOf(given, above);
console.log("given a parent", names(given), "|", names(other));
above.later = "laid later";
console.log("the parent gains a name", names(given), "|", names(other));
Object.setPrototypeOf(given, null);
console.log("cut off again", names(given), "|", names(other));
Object.setPrototypeOf(given, hide(above));
delete above.up;
console.log("the parent loses a name", names(given));

const grows = bare(3);
console.log("grows", names(grows));
grows.d = 4;
console.log("one more", names(grows), "|", names(bare(4)));
delete grows.b;
console.log("one less", names(grows), "|", names(bare(5)));
grows.b = "again";
console.log("again", names(grows));
Object.defineProperty(grows, "c", { enumerable: false });
console.log("hidden", names(grows), "|", names(bare(6)));
grows[2] = "two"; grows[0] = "zero";
console.log("indexes", names(grows));

const shadowed = { __proto__: { __proto__: null, a: "far", z: "far z" }, a: "near" };
console.log("two steps to null", names(shadowed));
const belowBare = Object.create(bare(7));
belowBare.own = 1;
console.log("below a bare one", names(belowBare));
function whileItRuns() { const r = bare(8), seen = []; for (const k in r) { seen.push(k); if (k === "a") { delete r.b; r.e = 5; } } return seen.join(); }
console.log("changed while it runs", whileItRuns(), whileItRuns());
const maker = Object.create(null);
maker.x = 1; maker.y = 2;
for (let i = 0; i < 50; i++) text = names(maker);
console.log("a maker", text);
console.log("empty", names({ __proto__: null }) === "", names(Object.create(null)) === "");
