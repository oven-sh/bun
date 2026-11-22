"use strict";
function make() { let list = [1, 2, 3, 4, 5, 6]; const other = [6, 5, 4, 3, 2, 1, 0];
  return function total(r) { let s = 0; const first = list; for (let i = 0; i < list.length; i++) { if (i === (r & 3)) list = other; s = s * 3 + list[i]; } list = first; return s; }; }
const total = make();
function step(r) { return total(r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
