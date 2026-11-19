// Names that a loop only truncates, sums that are handed to functions that take numbers, and numbers that a loop steps by quotients.
const lines = [];
let calls = 0;
const counted = value => ({
  valueOf() {
    calls++;
    return value;
  },
});
const values = [
  ...JSON.parse("[0, 1, 2, 5, 1.5, 3.25, -0.5, -2.75, 12, 2147483647, 2147483648, 4294967297.5, -2147483649, 1e21, 1e300]"),
  -0,
  NaN,
  Infinity,
  undefined,
  null,
  true,
  "3",
  "2.5",
  "x",
  [4],
  {},
];

function span(list, from, to, value) {
  let n = 0;
  for (let k = from | 0; k < (to | 0); k++) {
    list[k] = value;
    if (++n > 20) break;
  }
  return n + ":" + list.slice(0, 6).join() + ":" + list.length;
}
function notNot(from, to) {
  let n = 0;
  for (let k = ~~from; k < ~~to; k++) if (++n > 20) break;
  return n;
}
function truncatedAndAdded(a) {
  let s = "";
  for (let k = 0; k < 4; k++) s += (a | 0) + k + "," + (a + k) + ";";
  return s;
}
function truncatedAndKey(list, a) {
  let s = 0;
  for (let k = 0; k < 4; k++) s += (a | 0) + (list[a] === undefined ? 1000 : list[a]);
  return s;
}
function at(list, t) {
  const i = t | 0;
  const f = t - i;
  return (list[i] === undefined ? 0 : list[i]) * (1 - f) + (list[i + 1] === undefined ? 0 : list[i + 1]) * f;
}
function sample(list, d) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += at(list, i + d);
  return s;
}
function lengthOf(t) {
  return typeof t === "string" ? 100 + t.length : String(t).length;
}
function handed(d) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += lengthOf(i + d);
  return s;
}
function line(grid, width, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = dx / n;
  const sy = dy / n;
  let x = x0;
  let y = y0;
  let c = 0;
  for (let i = 0; i <= n; i++) {
    const k = (y | 0) * width + (x | 0);
    grid[k] = (grid[k] || 0) + 1;
    x += sx;
    y += sy;
    if (++c > 20) break;
  }
  return c + ":" + grid.slice(0, 8).join("");
}
function stepped(list, from, to, n) {
  const step = (to - from) / n;
  let x = from;
  let s = 0;
  for (let i = 0; i < 5; i++) {
    s += list[x] === undefined ? 100 : list[x];
    x += step;
  }
  return s + ":" + x;
}

function say(name, f) {
  calls = 0;
  let result;
  try {
    result = f();
  } catch (error) {
    result = error.name;
  }
  lines.push(name + " " + calls + " " + result);
}
const list = [1, 2, 4, 8, 16, 32];
for (let round = 0; round < 2; round++) {
  values.forEach((a, i) => {
    for (const b of [2.5, 6]) {
      say("span " + i, () => span([7, 7, 7], a, b, 1));
      say("notNot " + i, () => notNot(a, b));
      say("line " + i, () => line([0, 0, 0, 0, 0, 0, 0, 0], 4, a, 0, b, 1));
      say("stepped " + i, () => stepped(list, a, b, 2));
    }
    say("added " + i, () => truncatedAndAdded(a));
    say("key " + i, () => truncatedAndKey(list, a));
    say("sample " + i, () => sample(list, a));
    say("handed " + i, () => handed(a));
  });
}
say("counted span", () => span([7, 7, 7], counted(0.5), counted(2.5), 1));
say("counted sample", () => sample(list, counted(1.5)));
say("counted handed", () => handed(counted(1.5)));
say("bigint", () => sample(list, 1n));
say("symbol", () => span([1], Symbol(), 2, 1));
console.log(lines.join("\n"));
