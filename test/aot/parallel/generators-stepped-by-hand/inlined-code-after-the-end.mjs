// What the loop does between the step that finds the generator done and the test of done is inlined there, and its frames are its own.
let state = 0;
function note(v) { state++; return v; }
function fail(v) { if (v === 1) throw new Error("failed"); return v; }
function pick(v, w) { let t = 0; for (let k = 0; k < 3; k++) { if (k === w) continue; t += v === undefined ? 1 : 2; } return t; }
function* ofDefault(a, b = note(2)) { for (let k = 0; k < b; k++) yield a + k; return "end"; }
function* ofPattern({ a, b = note(1) }) { yield a; yield b; return "end"; }
function* plain(a) { yield a; yield a + 1; return "end"; }
const frames = error => error.stack.split("\n").slice(1).map(line => line.trim().replace(/\(?[^\s()]*[\\/][^:]*/, "").replace(/:(\d+):\d+/, ":$1")).filter(line => /fail|lastTurn|atEnd|patterns|first/.test(line)).slice(0, 3).join(" | ");
function lastTurn(x, at) {
  let t = 0;
  const it = ofDefault(x);
  while (true) {
    const r = it.next();
    t += pick(r.value, x);
    t += r.done ? fail(at) : 10;
    if (r.done) break;
  }
  return t;
}
function atEnd(x, at) {
  let t = 0;
  const it = plain(x);
  for (let r = it.next(); ; r = it.next()) {
    t += pick(r.value, x);
    if (r.done) { t += fail(at); break; }
    t++;
  }
  return t;
}
function patterns(x, at) {
  let t = 0, r;
  const it = ofPattern({ a: x });
  do {
    r = it.next();
    t += pick(r.value, 1) + fail(r.done ? at : 0);
  } while (!r.done);
  return t;
}
function first(x, at) {
  let t = 0;
  const it = ofDefault(x, x);
  for (let r = it.next(); !r.done; r = it.next(t)) {
    t += pick(r.value, 2);
  }
  return t + fail(at);
}
const out = [];
for (let turn = 0; turn < 3; turn++) {
  for (const f of [lastTurn, atEnd, patterns, first]) {
    for (const x of [0, 1, 2, "a"]) {
      for (const at of [0, 1]) {
        try { out.push(f.name + " " + f(x, at)); } catch (error) { out.push(f.name + " " + error.message + " " + frames(error)); }
      }
    }
  }
}
let sum = 0;
for (let k = 0; k < 400; k++) sum += lastTurn(k & 3, 0) + atEnd(k & 3, 0) + patterns(k & 3, 0) + first(k & 3, 0);
console.log(out.join("\n") + "\n" + sum + " " + state);
