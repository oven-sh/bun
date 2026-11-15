// Variables of the file that a loop's calls fill once, beside variables that they compute from themselves: undefined, null and numbers before, filled in the first iteration, later, never, again.
const out = [];
let cache; function get(k) { if (cache === undefined) cache = k * 2 + 1; return cache; }
let best = null; function max(v) { if (best === null || v > best) best = v; return best; }
let n = 0, m; function add(x) { n += x; } function acc(x) { m = (m ?? 0) + x; }
let late; function fill(k) { if (k === 7) late = k / 2; return late ?? -1; }
let again; function refill(k) { if (again === undefined || k % 9 === 0) again = k + 0.5; else again += 1; return again; }
let never; function look(k) { return never === undefined ? k : never; }
let seed = 49734321; function next() { seed = ((seed * 16807) ^ (seed >>> 13)) & 0x7fffffff; return seed & 7; }
function run(turns) { let t = 0; for (let k = 0; k < turns; k++) { t += get(k) + max((k * 7) & 31) + fill(k) + refill(k) + look(k) + next(); add(k & 7); acc(k & 3); } return t; }
out.push(run(0), cache, best, m, late, again); out.push(run(1), cache, best, m); out.push(run(6), late); out.push(run(40), cache, best, n, m, late, again, seed);
cache = undefined; best = null; m = undefined; late = "t"; again = undefined; never = 3; out.push(run(12), cache, best, n, m, late, again);
console.log(out.join(" "));
