// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
function attempt(deed) { try { deed(); } catch (error) { console.log("refused:", error instanceof TypeError); } }
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
const own = function (at) { calls++; return "own" + at; };
const made = Buffer.alloc(16, 3);
new Function("on", "what", "on.readUInt8 = what;")(made, own);
function sum() { let s = 0; for (let i = 0; i < 8; i++) s = s + made.readUInt8(i); return s; }
let last;
for (let t = 0; t < 300; t++) last = sum();
console.log(last, typeof last, calls);
