// `i < n` says how large i is only where n is an int32. The same loops run with bounds of every kind, first often with small integers.
function low(i) {
  return i & 7;
}
function Point(x) {
  this.x = x;
}
function Pair(x) {
  Point.apply(this, arguments);
  this.y = 2;
}
Object.setPrototypeOf(Pair.prototype, Point.prototype);

function up(from, n) {
  let sum = 0, turns = 0, last = "none";
  for (let i = from; i < n; i++) {
    sum = (sum + low(i)) | 0;
    last = i;
    if (++turns === 40) break;
  }
  return sum + " " + turns + " " + last;
}
function upTo(from, n) {
  let sum = 0, turns = 0, last = "none";
  for (let i = from; i <= n; i++) {
    sum = (sum + low(i)) | 0;
    last = i + 1;
    if (++turns === 40) break;
  }
  return sum + " " + turns + " " + last;
}
function down(from, n) {
  let sum = 0, turns = 0, last = "none";
  for (let i = from; i > n; i--) {
    sum = (sum + low(i)) | 0;
    last = i - 1;
    if (++turns === 40) break;
  }
  return sum + " " + turns + " " + last;
}
function boundOnTheLeft(from, n) {
  let sum = 0, turns = 0, last = "none";
  for (let i = from; n > i; i += 3) {
    sum = (sum + low(i)) | 0;
    last = i + 3;
    if (++turns === 40) break;
  }
  return sum + " " + turns + " " + last;
}
function objects(from, n) {
  let sum = 0, turns = 0;
  for (let i = from; i < n; i++) {
    const pair = new Pair(i);
    sum += pair.x + pair.y;
    if (++turns === 40) break;
  }
  return sum + " " + turns;
}
function stepAheadOfTheTest(from, n) {
  let i = from, sum = 0, turns = 0;
  while (i++ < n) {
    sum += i;
    if (++turns === 40) break;
  }
  return sum + " " + turns + " " + i;
}

const loops = [up, upTo, down, boundOnTheLeft, objects, stepAheadOfTheTest];
let warm = 0;
for (let turn = 0; turn < 3000; turn++) {
  for (const loop of loops) warm += loop(turn & 3, (turn & 15) + (loop === down ? -8 : 4)).length;
}
console.log(warm);

let asked = 0;
const bounds = [
  5, 0, -0, -3, 2.5, -2.5, 1e-9, NaN, Infinity, -Infinity,
  2147483646, 2147483647, 2147483648, 2147483649, 4294967295, 4294967296, 4294967301,
  -2147483647, -2147483648, -2147483649, -4294967301,
  9007199254740991, 9007199254740992, 1e21, -1e21,
  "5", "2147483650", "", " 7 ", "seven", "0x10", null, undefined, true, false,
  7n, 2147483650n, -2147483650n, 123456789012345678901234567890n,
  [], [9], [1, 2], {},
  { valueOf() { asked++; return 6; } },
  { valueOf() { asked++; return 2147483651; } },
  { toString() { asked++; return "4"; } },
  { [Symbol.toPrimitive](hint) { asked++; return hint === "number" ? 3 : "wrong"; } },
];
const starts = [
  0, 1, -1, -0, 0.5, -5, 2147483640, 2147483646, 2147483647, 2147483648, 4294967290, 4294967296,
  -2147483640, -2147483647, -2147483648, -2147483649, -4294967300, 9007199254740980, NaN, Infinity, -Infinity,
];
function name(value) {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (Object.is(value, -0)) return "-0";
  if (Array.isArray(value)) return "[" + value + "]";
  return typeof value === "object" && value ? "object" : String(value);
}
for (const loop of loops) {
  for (const n of bounds) {
    const row = [];
    for (const from of starts) row.push(loop(from, n));
    console.log(loop.name, name(n), row.join(" | "));
  }
}
console.log(asked);

for (const loop of loops) {
  for (const n of [Symbol("bound"), { valueOf() { throw new RangeError("asked"); } }]) {
    try {
      console.log(loop.name, loop(0, n));
    } catch (error) {
      console.log(loop.name, error.constructor.name);
    }
  }
}

// The loops are still right for what they ran with at first.
let again = 0;
for (let turn = 0; turn < 3000; turn++) {
  for (const loop of loops) again += loop(turn & 3, (turn & 15) + (loop === down ? -8 : 4)).length;
}
console.log(again === warm);
