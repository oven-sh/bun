// None of these loops is given room: what is held is the answers.
"use strict";
function breaks(n, at) { const got = []; for (let j = 0; j < n; j++) { got.push(j); if (j === at) break; } return got.length; }
function returns(n, at) { const got = []; for (let j = 0; j < n; j++) { got[j] = j; if (j === at) return got.length; } return -got.length; }
function throws(n, at, l) { const got = []; try { for (let j = 0; j < n; j++) { got.push(l[j].x); } } catch (e) { return e.constructor.name + got.length; } return got.length; }
const l = [{ x: 1 }, { x: 2 }, { x: 3 }];
function step(r) { return [breaks(1000 + r, r), returns(1000 + r, r), throws(1000 + r, r, l)].join(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
