// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
function attempt(deed) { try { deed(); } catch (error) { console.log("refused:", error instanceof TypeError); } }
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
const own = function (at) { calls++; return "own" + at; };
const view = Buffer.alloc(16, 3);
function sum() { let s = 0; for (let i = 0; i < 8; i++) s = s + view.readUInt8(i); return s; }
let last;
for (let t = 0; t < 300; t++) { if (t === 200) view.readUInt8 = own; last = sum(); }
console.log(last, typeof last, calls);
