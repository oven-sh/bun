// None of these loops is given room: what is held is the answers.
"use strict";
function fill(n) { const got = [7]; for (let j = 1; j <= n; j++) got[j] = j * 2; return got.length + ":" + got[got.length - 1]; }
const bounds = [0, -1, 2.5, NaN, 3, -0, 1e-9, 24, 25, 26, 27.999, Infinity > 1 ? 30 : 0];
function step(r) { return fill(bounds[r]); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
