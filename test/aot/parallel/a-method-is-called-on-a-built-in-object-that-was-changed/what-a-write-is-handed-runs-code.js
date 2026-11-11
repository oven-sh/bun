// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
function attempt(deed) { try { deed(); } catch (error) { console.log("refused:", error instanceof TypeError); } }
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
const view = Buffer.alloc(16);
let asked = 0;
const odd = { valueOf() { asked++; view.writeUInt8 = function () { calls++; return "own"; }; return 7; } };
console.log(view.writeUInt8(odd, 0), view.writeUInt8(1, 1), view[0], asked, calls);
