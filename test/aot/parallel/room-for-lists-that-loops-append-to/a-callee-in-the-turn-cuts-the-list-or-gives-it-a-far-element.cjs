// None of these loops is given room: what is held is the answers.
"use strict";
function meddle(got, j, r) { if (j === r) got.length = 1; if (j === r + 2 && (r & 1)) got[5000] = "far"; return j; }
function fill(n, r) { const got = [0]; for (let j = 1; j <= n; j++) got.push(meddle(got, j, r)); return got.length + ":" + Object.keys(got).length; }
function step(r) { return fill(4 + r * 2, r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
