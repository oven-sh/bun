// A scope that only the function of one way holds is born there, with what its variables hold by then; what other ways store is stored into no scope. Loops make one a turn, functions change the variables, and handlers see them.
const lines = [], made = [];
function chosen(flag, start) { let count = start, label = "a"; if (flag) { count += 10; made.push(() => label + count++); label = "b"; return label + count; } count *= 2; label += count; return label; }
function turns(list) { const all = []; let seen = 0; for (let k = 0; k < list.length; k++) { let value = list[k], twice = value * 2; seen += twice; if (value > 5) all.push(() => value + twice + k); else value = twice = 0; seen += value; } return seen + ":" + all.map(one => one()).join(); }
function both(flag) { let shared = 1; const bump = () => ++shared; if (flag === 1) return [bump, () => shared]; if (flag === 2) { shared = 50; return [bump, () => -shared]; } shared = "none"; return [() => shared, () => shared]; }
function caught(value) { let state = "before"; try { state = "inside"; if (value === 1) made.push(() => state); if (value === 2) throw new RangeError("two"); state = "after"; } catch (error) { state += error.constructor.name; made.push(() => state + "!"); } finally { state += "."; } return state; }
function nested(depth) { let here = depth; if (depth === 0) return () => here; const inner = nested(depth - 1); if (depth % 2) return () => here + "(" + inner() + ")"; here = -1; return inner; }
function parameters(first, second = () => first) { if (first > 3) { first++; return second; } first = "unused"; return () => "plain"; }
function* steps(limit) { let at = 0; while (at < limit) { const now = at; if (now % 2) yield () => now + ":" + at; at++; } }
async function later(flag) { let value = 1; await null; if (flag) { value = 2; await null; const read = () => value; value = 3; return read(); } value = 9; return value; }
function deleted(flag) { var value = 4; if (flag) { var read = function () { return typeof value + value; }; value = undefined; } return read ? read() : value; }
for (let round = 0; round < 30; round++) {
  lines.push([chosen(round % 3 === 0, round), chosen(false, round), turns([round, 7, 3, 9 - round]), both(round % 3).map(one => one()).join(), both(1).map(one => one()).join(), caught(round % 4), nested(round % 6)(), parameters(round % 7)(), parameters(5, () => "given")(), deleted(round % 2)].map(String).join(" "));
  if (round % 10 === 9) lines.push(made.map(one => one()).join(), [...steps(7)].map(one => one()).join());
}
Promise.all([later(true), later(false), later(true)]).then(values => { lines.push(values.join()); console.log(lines.join("\n")); });
