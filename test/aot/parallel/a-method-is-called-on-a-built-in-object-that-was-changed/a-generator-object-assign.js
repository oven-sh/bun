// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
function attempt(deed) { try { deed(); } catch (error) { console.log("refused:", error instanceof TypeError); } }
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
const own = function () { calls++; return { value: "own", done: false }; };
const made = (function* () { for (;;) yield 3; })();
Object.assign(made, { next: own });
function sum() { let s = 0; for (let i = 0; i < 8; i++) s = s + made.next().value; return s; }
let last;
for (let t = 0; t < 300; t++) last = sum();
console.log(last, typeof last, calls);
