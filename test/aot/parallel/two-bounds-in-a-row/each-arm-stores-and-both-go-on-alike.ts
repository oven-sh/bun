// Two tests of bounds in a row. Each arm stores something of its own, and both hand the same value on.
class Counts {
  below = 0;
  above = 0;
}
function count(values: Int32Array, counts: Counts): number {
  let inside = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < 3) {
      counts.below = 5;
      continue;
    }
    if (v > 9) {
      counts.above = 7;
      continue;
    }
    inside++;
  }
  return inside;
}
for (const list of [[1], [12], [1, 12], [4, 5], [12, 4], [3, 9], [2, 10]]) {
  const counts = new Counts();
  console.log(count(Int32Array.from(list), counts), counts.below, counts.above);
}

let left = 0;
let right = 0;
function ask(i: number): number {
  if (i < 3) {
    left = 1;
    return 10;
  }
  if (i > 9) {
    right = 1;
    return 10;
  }
  return 20;
}
function unsigned(i: number): number {
  const u = i >>> 0;
  if (u < 3) {
    left = u + 1;
    return 10;
  }
  if (u > 9) {
    right = u;
    return 10;
  }
  return 20;
}
function reversed(i: number): number {
  if (i >= 10) {
    right = 1;
    return 10;
  }
  if (i <= 2) {
    left = 1;
    return 10;
  }
  return 20;
}
function run(f: (i: number) => number, from: number, to: number): string {
  let text = "";
  for (let v = from; v < to; v++) {
    left = 0;
    right = 0;
    const answer = f(v);
    text += v + ":" + answer + (left ? "L" + left : "") + (right ? "R" + right : "") + " ";
  }
  return text;
}
function runAsk(): string {
  let text = "";
  for (let v = -2; v < 14; v++) {
    left = 0;
    right = 0;
    const answer = ask(v);
    text += v + ":" + answer + (left ? "L" : "") + (right ? "R" : "") + " ";
  }
  return text;
}
console.log(runAsk());
console.log(run(ask, -2, 13));
console.log(run(unsigned, -2, 13));
console.log(run(reversed, -2, 13));

// Twins: both arms only hand a value on, or the same one.
function onlyHandsOn(i: number): number {
  let r: number;
  if (i < 3) r = 10;
  else if (i > 9) r = 10;
  else r = 20;
  return r;
}
function differ(i: number): number {
  let r: number;
  if (i < 3) r = 10;
  else if (i > 9) r = 11;
  else r = 20;
  return r;
}
let text = "";
for (let v = -2; v < 14; v++) text += onlyHandsOn(v) + "/" + differ(v) + " ";
console.log(text);
