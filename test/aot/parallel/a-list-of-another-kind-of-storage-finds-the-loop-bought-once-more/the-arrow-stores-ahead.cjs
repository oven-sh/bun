// STATISTIC: LoopsReversionedForOtherIndexingType >= 1
"use strict";
const OUT = [];
const XS = Array.from({ length: 12 }, (_, i) => i * 3 % 7);
const YS = Array.from({ length: 12 }, (_, i) => (i === 11 ? null : i * 3 % 7));
const ZS = Array.from({ length: 12 }, (_, i) => i * 3 % 7);
const WS = Array.from({ length: 12 }, (_, i) => i * 3 % 7);
let LIST = XS, AT = 0, WHAT = null;
function total(t) { let s = t; LIST.forEach((x, i) => { if (i === AT) LIST[i + 1] = WHAT; s += x; }); return s; }
for (let t = 0; t < 12; t++) { LIST = t === 3 ? ZS : t === 7 ? WS : t & 1 ? YS : XS; AT = t; WHAT = t & 2 ? null : t & 4 ? undefined : 3; OUT.push(total(t)); OUT.push(LIST.join()); }
console.log(OUT.join(" "));
