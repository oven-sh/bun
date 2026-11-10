"use strict";
// STATISTIC: ArrayIterationsWithStringFallback >= 1
const log = [];
const outside = JSON.parse('[["a", ",", "b"], [], [","], ["ab", ",,", 1, null, true, ","], [["a"], ","]]');
const parts = input => { let commas = 0, rest = ""; for (const ch of input) { if (ch === ",") commas++; else rest += "<" + String(ch) + ">"; } return commas + ":" + rest; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { parts: input => parts(unknown(input)) };
for (let turn = 0; turn < 3; turn++) for (const list of outside) log.push(veil.parts(list));
const holes = ["a", , ",", , "b"]; log.push(veil.parts(holes)); const long = outside[0].concat(outside[1], outside[0]); log.push(veil.parts(long));
class Below extends Array {} log.push(veil.parts(Below.from(["x", ",", "y"])), veil.parts(Object.freeze(["f", ","])), veil.parts(new Array(3)), veil.parts(Array.from({ length: 2 }, (_, at) => at ? "," : "z")));
const named = ["n", ","]; named.extra = 1; log.push(veil.parts(named)); const withGetter = ["g", ",", "h"]; Object.defineProperty(withGetter, 1, { get() { log.push("got"); return ","; } }); log.push(veil.parts(withGetter));
const own = ["o", ","]; own[Symbol.iterator] = function* () { yield ","; yield "own"; }; log.push(veil.parts(own));
console.log("SAID", log.join(" | "));
