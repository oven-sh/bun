// A function is written over Math.random and called in loops whose turns also read fields, append and call methods that change: what its state was is right where a turn goes on as written, and where the function throws.
const before = Math.random;
let state = 11, calls = 0;
Math.random = function random() { calls++; state = (state * 171 + 11213) % 53125; if (calls === 137) throw new RangeError("out of numbers"); return state / 53125; };
const held = JSON.parse("{}"), name = text => text + process.argv.length % 1;
class Cloud { constructor(count) { this.points = []; this.sum = 0; this.count = count; } add(x, y) { this.points.push(x); this.sum += y; } }
held[name("fill")] = function fill(cloud) { for (let k = 0; k < cloud.count; k++) cloud.add(Math.random() * 10, Math.random()); return cloud.sum; };
held[name("inside")] = function inside(count) { let hits = 0; for (let k = 0; k < count; k++) { const x = Math.random(), y = Math.random(); if (x * x + y * y < 1) hits++; } return hits; };
held[name("rows")] = function rows(list) { for (let r = 0; r < list.length; r++) for (let c = 0; c < list[r].length; c++) list[r][c] += Math.random() - 0.5; return list; };
held[name("named")] = function named(list) { let sum = 0; for (let k = 0; k < list.length; k++) { const draw = Math.random(); sum += list[k].weight * draw; } return sum; };
const lines = [], say = value => typeof value === "number" ? value.toFixed(9) : String(value);
const attempt = (form, ...given) => { let answer; try { answer = held[name(form)](...given); } catch (error) { answer = error.constructor.name; } lines.push([form, Array.isArray(answer) ? answer.map(row => row.map(say)).join("|") : say(answer), state, calls].join(" ")); };
for (let round = 0; round < 5; round++) {
  const cloud = new Cloud(6); attempt("fill", cloud); lines.push(cloud.points.length);
  const strange = new Cloud(5); strange.add = round & 1 ? (x, y) => { Math.random(); strange.sum -= y; } : strange.add; attempt("fill", strange);
  Object.defineProperty(strange, "count", { get() { state = 5; return 3; } }); attempt("fill", strange);
  attempt("inside", 9 + round);
  attempt("rows", [[1, 2, 3], [0.5, 1.5], ["4", 5], [], [null, undefined]]); attempt("rows", [[1, 2], Object.freeze([1, 2]), [3]]);
  attempt("named", [{ weight: 1 }, { weight: 2.5 }, { weight: "3" }, { get weight() { return Math.random() * 0 + 1; } }, { other: 1 }]);
  attempt("named", [{ weight: 1 }, null, { weight: 2 }]);
}
lines.push(calls);
Math.random = before;
lines.push(Math.random === before, held[name("inside")](3) <= 3, calls);
console.log(lines.join("\n"));
