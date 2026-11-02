// `while (++i < n)`, `while (--n >= 0)`, `do .. while (++i < n)`: the test looks at what the turn has counted up. Bounds and starts of every kind, counters read in the body and behind the loop.
const list = [];
for (let i = 0; i < 23; i++) list.push(i * 3 + 1);
const bounds = [0, 1, 2, 22, 23, 24, 22.5, -1, -0, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, "7", null, undefined, { valueOf() { return 5; } }];
const starts = [0, 1, -1, -0, 0.5, 2147483640, 2147483646, 2147483647, 2147483648, -2147483640, -2147483647, -2147483648, -2147483649, 4294967290, 9007199254740990, -9007199254740990, NaN, Infinity, "3", null, undefined];
const lines = [];

function upOverList(values) {
  let i = -1, sum = 0;
  while (++i < values.length) sum += values[i];
  return sum + ":" + i;
}
function downOverList(values) {
  let n = values.length, sum = 0;
  while (--n >= 0) sum = (sum * 31 + values[n]) | 0;
  return sum + ":" + n;
}
function atTheEnd(values) {
  let i = 0, sum = 0;
  do {
    sum += values[i];
  } while (++i < values.length);
  return sum + ":" + i;
}
// The inner loop of a big number library.
function multiplyAndAdd(from, i, x, into, j, c, n) {
  while (--n >= 0) {
    const v = x * from[i++] + into[j] + c;
    c = Math.floor(v / 0x4000000);
    into[j++] = v & 0x3ffffff;
  }
  return c + ":" + i + ":" + j + ":" + n;
}
function upTo(bound, from, most) {
  let n = 0, i = from;
  while (++i < bound && n < most) n++;
  return n + ":" + i;
}
function upToOrEqual(bound, from, most) {
  let n = 0, i = from;
  while (++i <= bound && n < most) n++;
  return n + ":" + i;
}
function downTo(bound, from, most) {
  let n = 0, i = from;
  while (--i > bound && n < most) n++;
  return n + ":" + i;
}
function downToOrEqual(bound, from, most) {
  let n = 0, i = from;
  while (--i >= bound && n < most) n++;
  return n + ":" + i;
}
function boundOnTheLeft(bound, from, most) {
  let n = 0, i = from;
  while (bound > ++i && n < most) n++;
  return n + ":" + i;
}
function testedAtTheEnd(bound, from, most) {
  let n = 0, i = from;
  do n++;
  while ((i += 2) < bound && n < most);
  return n + ":" + i;
}
function untilFalsy(from, most) {
  let n = 0, i = from;
  while (--i && n < most) n++;
  return n + ":" + i;
}
function pastInt32Up() {
  let i = 2147483640, seen = "";
  while (++i <= 2147483647) seen += (i | 0) + ",";
  return seen + i;
}
function pastInt32Down() {
  let i = -2147483641, seen = "";
  while (--i >= -2147483648) seen += (i | 0) + ",";
  return seen + i;
}
function nested(values) {
  let sum = 0, i = -1;
  while (++i < values.length) {
    let k = values.length;
    while (--k > i) sum = (sum + values[i] * values[k]) | 0;
  }
  return sum;
}
function aroundATry(count) {
  let i = count, seen = "";
  while (--i >= 0) {
    try {
      if (i & 1) throw i;
      seen += i;
    } catch (error) {
      seen += "(" + error + ":" + i + ")";
    }
  }
  return seen + i;
}
function* yields(values) {
  let i = -1;
  while (++i < values.length) yield values[i] + i;
  return i;
}
async function awaits(values) {
  let n = values.length, sum = 0;
  while (--n >= 0) sum += await values[n];
  return sum + ":" + n;
}

for (let round = 0; round < 3; round++) {
  lines.push(upOverList(list), downOverList(list), atTheEnd(list), pastInt32Up(), pastInt32Down(), nested(list), aroundATry(7 + round));
  lines.push(upOverList([]), downOverList([]), atTheEnd([]), upOverList([1.5, "a", , 4]), downOverList([1.5, "a", , 4]), downOverList({ length: 3, 0: 1, 1: 2, 2: 3 }));
  lines.push(multiplyAndAdd(list, 0, 67108863, list.slice(), 2, round, 20), multiplyAndAdd(list, 3, 1.5, [1, 2, 3], 0, 0, 3), multiplyAndAdd(list, 0, 2, [], 0, 0, 0), multiplyAndAdd(list, "1", 2, [5, 6], 0, 1, "2"));
  let text = "";
  const walk = yields(list);
  for (let step = walk.next(); ; step = walk.next()) {
    text += step.value + ",";
    if (step.done) break;
  }
  lines.push(text, await awaits(list));
}
for (const bound of bounds) {
  for (const from of starts)
    lines.push([upTo(bound, from, 9), upToOrEqual(bound, from, 9), downTo(bound, from, 9), downToOrEqual(bound, from, 9), boundOnTheLeft(bound, from, 9), testedAtTheEnd(bound, from, 9)].join(" "));
}
for (const from of starts) lines.push(untilFalsy(from, 9));
console.log(lines.join("\n"));
