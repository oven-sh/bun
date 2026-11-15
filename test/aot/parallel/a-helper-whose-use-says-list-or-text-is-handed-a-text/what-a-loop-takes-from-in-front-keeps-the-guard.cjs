"use strict";
// STATISTIC: ArrayOrStringLoopsVersioned >= 1
// Where a loop takes what was read off the holder in front of it (the length as a start or as a bound), the guard keeps its word, as it does for lists and bytes. A question in front that no loop takes leaves the front standing.
const key = JSON.parse('"go"');
const down = { go(s) { let c = 0; for (let i = s.length - 1; i >= 0; i--) if (s[i] === ",") c++; return c; } };
const taken = { go(s) { let c = 0; for (let i = 0, n = s.length; i < n; i++) if (s[i] === ",") c++; return c; } };
const first = { go(s) { let c = s[0] === "," ? 1 : 0; for (let i = 1; i < s.length; i++) if (s[i] === ",") c++; return c; } };
for (const s of [JSON.parse('"ab,cd,,"'), "", JSON.parse('["a",",",","]'), [",", , ","], { length: 2, 0: ",", 1: "," }, new Uint8Array([44])]) for (let turn = 0; turn < 3; turn++) console.log(down[key](s), taken[key](s), first[key](s));
