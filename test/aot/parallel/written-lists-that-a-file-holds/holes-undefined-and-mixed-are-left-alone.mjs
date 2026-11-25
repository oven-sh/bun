const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const HOLES = [1, , 3]; const NOTHING = [1, undefined, 3]; const MIXED = [1, "b", 3]; const EMPTY = [];
function sumOf(which) { let s = 0; const t = which === 0 ? HOLES : which === 1 ? NOTHING : which === 2 ? MIXED : EMPTY; for (let i = 0; i < t.length; i++) s += t[i]; return s; }
function sumHoles() { let s = 0; for (let i = 0; i < HOLES.length; i++) s += HOLES[i] * 2; return s; }
function sumNothing() { let s = 0; for (let i = 0; i < NOTHING.length; i++) s += NOTHING[i] * 2; return s; }
say(unseen(sumOf)(0), unseen(sumOf)(1), unseen(sumOf)(2), unseen(sumOf)(3), unseen(sumHoles)(), unseen(sumNothing)());
