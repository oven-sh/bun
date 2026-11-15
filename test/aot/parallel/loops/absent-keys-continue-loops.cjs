// STATISTIC: AbsentKeysContinueLoops >= 3
// `while (..) { const found = map.get(key++); if (found == null) continue; .. }`: the lookup of an absent key leads into the next iteration.
"use strict";
class State { constructor(line) { this.line = line; this.hits = 0; } }
function run(statements, state, end) {
  while (state.line != null && state.line < end) {
    const statement = statements.get(state.line++);
    if (statement == null) continue;
    state.hits += statement.weight;
  }
  return state.hits;
}
function sum(map, from, to) {
  let i = from, total = 0, before = -1, steps = 0;
  while (i < to) {
    const key = i++;
    steps++;
    const found = map.get(key);
    if (found === undefined) continue;
    total += found * 2 + before;
    before = key;
  }
  return [total, before, steps, i].join();
}
function swap(map, keys) {
  let a = 1, b = 2.5, c = "c", at = 0;
  while (at < keys.length) {
    const t = a; a = b; b = t; c = c.length > 6 ? "c" : c + at;
    const found = map.get(keys[at++]);
    if (found === undefined) continue;
    a = found; c = "f";
  }
  return [a, b, c, at].join();
}
function nested(map, rows, columns) {
  let row = 0, total = 0, skipped = 0;
  outer: while (row < rows) {
    let column = 0;
    row++;
    while (column < columns) {
      const found = map.get(row * columns + column++);
      if (found === undefined) { skipped++; continue; }
      if (found < 0) continue outer;
      const second = map.get(found);
      if (second == null) continue outer;
      total += second;
    }
    total++;
  }
  return [total, skipped].join();
}
function pushed(map, to) {
  const list = [], missed = [];
  let i = 0;
  while (i < to) {
    missed.push(i);
    const found = map.get(i++);
    if (found === undefined) continue;
    missed.pop();
    list.push(found, list.length);
  }
  return list.join() + "|" + missed.join();
}
function* stepped(map, to) {
  let i = 0, seen = 0;
  while (i < to) {
    const found = map.get(i++);
    if (found === undefined) continue;
    seen++;
    const more = yield [i, found, seen];
    if (more) i += more;
  }
  return seen;
}
function guarded(map, to) {
  let i = 0, text = "";
  while (i < to) {
    try {
      const found = map.get(i++);
      if (found === undefined) continue;
      text += found.name;
    } catch (error) { text += "!"; } finally { if (i % 4 === 0) text += "."; }
  }
  return text;
}
function strings(map, words) {
  let i = 0, n = 0, last = null;
  do {
    const found = map.get(words[i++]);
    if (found === undefined) continue;
    n += found; last = words[i - 1];
  } while (i < words.length);
  return n + String(last);
}
function holes(map, to) {
  let i = -3, text = "";
  for (;;) {
    if (i > to) return text;
    const found = map.get(i++);
    if (found === undefined) continue;
    text += found === null ? "null," : found + ",";
  }
}
const sizes = [0, 1, 5, 8, 9, 40, 300, 3000];
for (const size of sizes) {
  const weights = new Map(), numbers = new Map(), any = new Map(), words = new Map(), objects = new Map();
  for (let k = 0; k < size; k++) {
    weights.set(k * 3 + 1, { weight: k });
    numbers.set(k * 2, k % 5 ? k / 2 : -k);
    any.set(k % 3 ? k : k * 7, k % 4 ? k : k % 8 ? undefined : null);
    words.set("w" + k * 2, k);
    objects.set(k * 2 + 1, k % 6 ? { name: "n" + k } : null);
  }
  if (size > 8) { numbers.delete(4); weights.delete(1); numbers.set(4, 4.5); }
  console.log(size, run(weights, new State(0), 120), run(weights, { line: 5, hits: 0.5 }, 90), run(weights, new State(null), 9));
  console.log(sum(numbers, 0, 70), sum(numbers, -5, 5), sum(numbers, 2147483640, 2147483650), sum(any, 0, 30));
  console.log(swap(numbers, [0, 2, 3, 5, -0, NaN, 1.5, 4]), swap(words, ["w0", "w1", "w2", "v"]), nested(numbers, 6, 7), pushed(numbers, 33));
  const steps = [], iterator = stepped(numbers, 50);
  for (let step = iterator.next(), n = 0; !step.done && n < 30; step = iterator.next(n++ % 3)) steps.push(step.value.join(":"));
  console.log(steps.join(), guarded(objects, 24), strings(words, ["w0", "w1", "w4", "w" + size, "w6"]), holes(any, 20));
}
