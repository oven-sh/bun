"use strict";
const given = JSON.parse('["a,", ["b", ","], "c"]');
const nest = (p0, p1, p2, p3) => { let n = 0; for (const c0 of p0) { if (c0 === ",") n += 1; for (const c1 of p1) { if (c1 === ",") n += 2; for (const c2 of p2) { if (c2 === ",") n += 3; for (const c3 of p3) { if (c3 === ",") n += 4; n++; } } } } return n; };
let sum = 0; for (let t = 0; t < 3; t++) sum += nest(given[(t + 0) % 3], given[(t + 1) % 3], given[(t + 2) % 3], given[(t + 3) % 3]);
console.log("SAID", sum);
