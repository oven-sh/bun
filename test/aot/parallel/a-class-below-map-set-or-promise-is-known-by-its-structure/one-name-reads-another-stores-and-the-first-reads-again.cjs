// Two names hold one object: what was read through the one is no longer known once the other has stored.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: operation:operationAOTFillSiteCache = 0
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } two() { return this.n + 1; } }
const one = new H();
const far = v => [v][JSON.parse("0")];
function f(a, b, t) { let x = 0, y = 0; for (let i = 0; i < 16; i++) { x = b.n; a.n = (t + i) & 255; y = b.n; } return x * 1000 + y; }
const turns = +(process.argv[2] ?? 300); let sum = 0;
const other = far(one);
for (let t = 0; t < turns; t++) sum = (sum + f(one, other, t)) % 1000003;
console.log(sum, String(one.n));
