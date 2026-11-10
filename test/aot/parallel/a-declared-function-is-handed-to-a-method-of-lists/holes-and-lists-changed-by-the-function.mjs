const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

const seen = [];
let target = null;
function grows(x, i) { if (i < 3) target.push(x * 10); seen.push(i); return x; }
function shrinks(x, i) { if (i === 1) target.length = 2; seen.push(i); return x; }
function swaps(x, i) { if (i === 0) target[2] = "late"; return x; }
function same(x) { seen.push(x); return x; }
function by(list, f) { target = list; return list.map(f); }
function each(list) { return [list.map(same), list.filter(same), list.some(same), list.every(same), list.find(same), list.findIndex(same)]; }
console.log(say(by([1, 2, 3], grows)), say(target), say(by([1, 2, 3, 4], shrinks)), say(target), say(by([1, 2, 3], swaps)), say(seen));
seen.length = 0; console.log(say(each([1, , 3, undefined, , 0])), say(seen)); const sparse = []; sparse[5] = 1; sparse.length = 8; seen.length = 0; console.log(say(each(sparse)), 2 in sparse.map(same), say(seen));
