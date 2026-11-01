// `while (n--)` from every kind of start: the compiled loop expects a counter that is zero or above, and whatever else comes has to go on as plain Bun does.
const lines = [];

// A start below zero, or with a fraction, never meets zero: `most` ends those.
function turnsFrom(n, most) {
  let turns = 0, last;
  while (n--) {
    last = n;
    if (++turns === most) break;
  }
  return turns + ":" + String(last) + ":" + String(n);
}
function sumDown(values, n) {
  let sum = 0;
  while (n--) sum = (sum * 31 + values[n]) | 0;
  return sum + ":" + n;
}
// The counter is wanted as a value, and is read behind the loop.
function positionsDown(n) {
  const seen = [];
  while (n--) seen.push(n);
  return seen.join() + ":" + n;
}
// Two counters, the inner one starts at the outer one.
function triangle(n) {
  let count = 0;
  while (n--) {
    let k = n;
    while (k--) count++;
  }
  return count + ":" + n;
}
function inATry(n) {
  let turns = 0;
  try {
    while (n--) {
      if (n === 2) throw new RangeError("at two");
      turns++;
    }
  } catch (error) {
    return error.message + ":" + turns + ":" + n;
  }
  return turns + ":" + n;
}

const say = (name, run) => {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.constructor.name;
  }
  lines.push(name + " " + answer);
};

const list = JSON.parse("[3,1,4,1,5,9,2,6]");
// Often enough as expected.
for (let round = 0; round < 4; round++) {
  say("turns 7", () => turnsFrom(7, 100));
  say("sum 8", () => sumDown(list, 8));
  say("positions 5", () => positionsDown(5));
  say("triangle 6", () => triangle(6));
  say("try 6", () => inATry(6));
}

const starts = [0, 1, 2, -0, -1, -2, -2147483647, -2147483648, -2147483649, 2147483646, 2147483647, 2147483648, 4294967295, 4294967296, 9007199254740991, 9007199254740992, -9007199254740992,
  0.5, -0.5, 1.5, 1e21, NaN, Infinity, -Infinity, "3", "", "x", " 2 ", null, undefined, true, false, [], [4], {}, { valueOf: () => 3 }, { valueOf: () => -1 }, { valueOf: () => 2n }, 0n, 1n, 3n, -2n, 2n ** 64n];
for (const start of starts) say("turns from " + (typeof start === "object" && start ? JSON.stringify(start, (_, v) => (typeof v === "function" ? "f" : v)) : String(start)) + " (" + typeof start + ")", () => turnsFrom(start, 6));
say("turns from a symbol", () => turnsFrom(Symbol.iterator, 6));

for (const n of [0, 1, 8, 9, 12, -0, "8", 8n, null]) say("sum " + String(n) + " (" + typeof n + ")", () => sumDown(list, n));
for (const n of [0, 1, 3, "3", true, 3n]) say("positions " + String(n) + " (" + typeof n + ")", () => positionsDown(n));
for (const n of [0, 1, 2, 9, "4"]) say("triangle " + String(n), () => triangle(n));
for (const n of [0, 2, 3, 4, "5"]) say("try " + String(n), () => inATry(n));

// valueOf runs once, in front of the first turn.
let asked = 0;
say("valueOf", () => turnsFrom({ valueOf: () => (asked++, 4) }, 100) + ":" + asked);

// And as expected again.
say("turns 7", () => turnsFrom(7, 100));
say("sum 8", () => sumDown(list, 8));

console.log(lines.join("\n"));
