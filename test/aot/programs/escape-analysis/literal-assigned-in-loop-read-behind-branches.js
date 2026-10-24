// A variable that is undefined or a literal assigned in a loop: the first read throws or proves that it holds the literal, and later reads stand behind branches that meet again.
function attempt(f, ...args) { try { return f(...args); } catch (error) { return error.name; } }

function arrayReadTwice(a, b, n, c) {
  let last;
  for (let i = 0; i < n; i++) last = [a + i, b + i];
  const first = last[0];
  let label;
  if (c) label = "yes"; else label = "no";
  return label + " " + first + " " + last[1] + " " + last.length;
}

function objectReadTwice(a, n, c) {
  let last;
  for (let i = 0; i < n; i++) last = { x: a + i, y: i };
  const first = last.x;
  const label = c ? "yes" : "no";
  return label + " " + first + " " + last.y;
}

function handedOn(a, n, c, use) {
  let last;
  for (let i = 0; i < n; i++) last = [a, i];
  use(last.length);
  if (c) use("taken");
  return use(last);
}

function nullOrLiteral(a, n, c) {
  let last = null;
  for (let i = 0; i < n; i++) last = { x: a + i };
  let sum = last.x;
  for (let i = 0; i < 2; i++) { if (c) sum += last.x; else sum -= last.x; }
  return sum;
}

function inOuterLoop(names, n) {
  const out = [];
  for (const name of names) {
    let last;
    for (let i = 0; i < n; i++) last = [name + i, name.length + i];
    out.push(String(last[0]), "|", String(last[1]));
  }
  return out.join(" ");
}

const seen = [];
const use = (v) => { seen.push(Array.isArray(v) ? v.join("-") : v); return seen.length; };
for (const n of [0, 1, 3]) {
  for (const c of [true, false]) {
    console.log(n, c, attempt(arrayReadTwice, 1, 10, n, c), "/", attempt(objectReadTwice, 5, n, c), "/", attempt(handedOn, "a", n, c, use), "/", attempt(nullOrLiteral, 2, n, c));
  }
  console.log(attempt(inOuterLoop, ["p", "qq"], n));
}
console.log(seen.join());
