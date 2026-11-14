"use strict";
const given = JSON.parse('["a,", ["b", ","], "c"]');
const row = p => { let n = 0; for (const c of p) { if (c === ",") n += 0; } for (const c of p) { if (c === ",") n += 1; } for (const c of p) { if (c === ",") n += 2; } for (const c of p) { if (c === ",") n += 3; } for (const c of p) { if (c === ",") n += 4; } for (const c of p) { if (c === ",") n += 5; } for (const c of p) { if (c === ",") n += 6; } for (const c of p) { if (c === ",") n += 7; } for (const c of p) { if (c === ",") n += 8; } for (const c of p) { if (c === ",") n += 9; } for (const c of p) { if (c === ",") n += 10; } for (const c of p) { if (c === ",") n += 11; } for (const c of p) { if (c === ",") n += 12; } for (const c of p) { if (c === ",") n += 13; } for (const c of p) { if (c === ",") n += 14; } for (const c of p) { if (c === ",") n += 15; } return n; };
let sum = 0; for (let t = 0; t < 3; t++) sum += row(given[t]);
console.log("SAID", sum);
