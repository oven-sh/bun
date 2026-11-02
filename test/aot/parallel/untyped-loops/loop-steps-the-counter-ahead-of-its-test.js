// `turns++ < n`, `i-- > 0`, `while (i--)`: the step stands in front of the test. Bounds and starts of every kind, counters read in the body and behind the loop, in plain functions, generators and async functions.
const list = [];
for (let i = 0; i < 23; i++) list.push(i * 3 + 1);
const bounds = [0, 1, 2, 22, 23, 24, 22.5, -1, -0, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967296, "7", null, undefined, { valueOf() { return 5; } }];
const starts = [0, 1, -1, -0, 0.5, 2147483640, 2147483646, 2147483647, 2147483648, -2147483640, -2147483647, -2147483648, -2147483649, 4294967290, 9007199254740990, NaN, Infinity, "3", null, undefined];
const lines = [];

function upOverList(values) {
  let turns = 0, sum = 0;
  while (turns++ < values.length) sum += values[turns - 1];
  return sum + ":" + turns;
}
function downOverList(values) {
  let sum = 0, i = values.length;
  for (; i-- > 0; ) sum += values[i];
  return sum + ":" + i;
}
function downForTruth(values) {
  let sum = 0, i = values.length;
  while (i--) sum = (sum * 31 + values[i]) | 0;
  return sum + ":" + i;
}
function twoCounters(values) {
  let turns = 0, sum = 0, x = 0;
  for (; turns++ < 16; x++) sum += values[x];
  return sum + ":" + turns + ":" + x;
}
function upTo(bound, from, most) {
  let n = 0, i = from;
  while (i++ < bound && n < most) n++;
  return n + ":" + i;
}
function upToOrEqual(bound, from, most) {
  let n = 0, i = from;
  while (i++ <= bound && n < most) n++;
  return n + ":" + i;
}
function downTo(bound, from, most) {
  let n = 0, i = from;
  while (i-- > bound && n < most) n++;
  return n + ":" + i;
}
function downToOrEqual(bound, from, most) {
  let n = 0, i = from;
  while (i-- >= bound && n < most) n++;
  return n + ":" + i;
}
function boundOnTheLeft(bound, from, most) {
  let n = 0, i = from;
  while (bound > i++ && n < most) n++;
  return n + ":" + i;
}
function untilFalsy(from, most) {
  let n = 0, i = from;
  while (i-- && n < most) n++;
  return n + ":" + i;
}
function byThree(bound, from, most) {
  let n = 0, i = from, before;
  while (((before = i), (i += 3), before) < bound && n < most) n++;
  return n + ":" + i + ":" + before;
}
function pastInt32Up() {
  let i = 2147483640, seen = "";
  while (i++ < 2147483647) seen += (i | 0) + ",";
  return seen + i;
}
function pastInt32Down() {
  let i = -2147483641, seen = "";
  while (i-- > -2147483648) seen += (i | 0) + ",";
  return seen + i;
}
function storesAtTheStep(count) {
  const kept = [];
  let turns = 0;
  while (turns++ < count) kept[turns - 1] = turns;
  return kept.join();
}
function pushes() {
  let turns = 0;
  const kept = [];
  for (let x = 0; turns++ < 16; x++) kept.push({ x });
  return kept.length + ":" + kept[15].x + ":" + turns;
}
function leavesInTheMiddle(values, at) {
  let i = values.length, sum = 0;
  while (i-- > 0) {
    if (i === at) break;
    if (i & 1) continue;
    sum += values[i];
  }
  return sum + ":" + i;
}
function nested(values) {
  let sum = 0, i = values.length;
  while (i-- > 0) {
    let k = i;
    while (k-- > 0) sum = (sum + values[i] * values[k]) | 0;
  }
  return sum;
}
function* yields(values) {
  let turns = 0;
  for (let x = 0; turns++ < values.length; x++) yield values[x] + turns;
  return turns;
}
function* pushesInGenerator() {
  let turns = 0;
  const kept = [];
  for (let x = 0; turns++ < 16; x++) kept.push({ x });
  return kept.length;
}
async function awaits(values) {
  let i = values.length, sum = 0;
  while (i-- > 0) sum += await values[i];
  return sum + ":" + i;
}
// A `try` right behind the test: the handler sees nothing that its block defines.
function tryBehindTheTest() {
  let out = "";
  let turns = 0;
  let a = Infinity;
  for (let x = 0; turns++ < 4; x += 0.5) {
    try {
      const m = Array.from(new Set([a, [a][0]]));
      out += m.indexOf(a) + " ";
    } catch (error) {
      out += "!";
    }
    a = a === 9 ? 3 : 9;
  }
  return out + turns;
}
function throwsBehindTheTest() {
  let v = 10, caught = 0;
  for (; v--; ) {
    try {
      Float32Array.intersection();
    } catch (e) {
      caught += v;
    }
  }
  return caught + ":" + v;
}
class Walker {
  walk() {
    let turns = 0, seen = 0;
    for (let x = 0; turns++ < 5; ) {
      try {
        const m = [...new Map([[turns, x]]).keys()];
        seen += m[0];
        if (turns === 3) throw m;
      } catch (error) {
        seen += turns * 100;
      }
    }
    return seen + ":" + turns;
  }
}

for (let round = 0; round < 3; round++) {
  lines.push(tryBehindTheTest(), throwsBehindTheTest(), new Walker().walk());
  lines.push(upOverList(list), downOverList(list), downForTruth(list), twoCounters(list), pastInt32Up(), pastInt32Down(), storesAtTheStep(5 + round), pushes(), nested(list));
  lines.push(upOverList([]), downOverList([]), downForTruth([]), upOverList([1.5, "a", , 4]), downOverList([1.5, "a", , 4]), downForTruth({ length: 3, 0: 1, 1: 2, 2: 3 }));
  for (const at of [-1, 0, 7, 22, 23]) lines.push(leavesInTheMiddle(list, at));
  let text = "";
  const walk = yields(list);
  for (let step = walk.next(); ; step = walk.next()) {
    text += step.value + ",";
    if (step.done) break;
  }
  lines.push(text, pushesInGenerator().next().value, await awaits(list));
}
for (const bound of bounds) {
  for (const from of starts)
    lines.push([upTo(bound, from, 9), upToOrEqual(bound, from, 9), downTo(bound, from, 9), downToOrEqual(bound, from, 9), boundOnTheLeft(bound, from, 9), byThree(bound, from, 9)].join(" "));
}
for (const from of starts) lines.push(untilFalsy(from, 9));
console.log(lines.join("\n"));
