// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
function attempt(deed) { try { deed(); } catch (error) { console.log("refused:", error instanceof TypeError); } }
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
const own = function () { calls++; return { value: "own", done: false }; };
const made = (function* () { yield 1; yield 2; })();
let turns = 0;
made.next = function () { calls++; return { value: "own", done: calls > 3 }; };
let s = 0;
for (const each of made) { s = s + each; turns++; }
console.log(s, turns, calls);
