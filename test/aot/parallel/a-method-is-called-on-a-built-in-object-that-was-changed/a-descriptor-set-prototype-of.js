// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
const own = function (at) { calls++; return "own" + at; };
const made = Object.getOwnPropertyDescriptor({ a: 1 }, "a");
Object.setPrototypeOf(made, { hasOwnProperty: own });
function sum() { let s = 0; for (let i = 0; i < 8; i++) s = s + made.hasOwnProperty("value"); return s; }
let last;
for (let t = 0; t < 100; t++) last = sum();
console.log(last, typeof last, calls);
