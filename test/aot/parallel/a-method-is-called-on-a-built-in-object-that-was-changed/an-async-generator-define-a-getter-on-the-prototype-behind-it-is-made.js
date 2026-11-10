// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
const own = function () { calls++; return "own"; };
async function* steps() { for (;;) yield 3; }
const made = steps();
Object.defineProperty(steps.prototype, "next", { get() { calls += 10; return own; } });
function sum() { let s = 0; for (let i = 0; i < 8; i++) s = s + (r => (typeof r === "string" ? r : 1))(made.next()); return s; }
let last;
for (let t = 0; t < 100; t++) last = sum();
console.log(last, typeof last, calls);
