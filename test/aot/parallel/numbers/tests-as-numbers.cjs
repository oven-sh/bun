// test ? 1 : 0, test ? 0 : 1 and their like over int32s, uint32s, doubles, NaN, -0, texts, BigInts and objects, in loops and outside of them.
function carry(a, b) {
  return (a >>> 0) < (b >>> 0) ? 1 : 0;
}
function borrow(a, b) {
  return (a | 0) < (b | 0) ? 0 : 1;
}
function below(a, b) {
  return a < b ? 1 : 0;
}
function notBelow(a, b) {
  return a < b ? 0 : 1;
}
function atMost(a, b) {
  let r = 0;
  if (a <= b) r = 1;
  return r + 10;
}
function above(a, b) {
  let r = 1;
  if (a > b) r = 0;
  return r;
}
function same(a, b) {
  return (a === b ? 1 : 0) + (a == b ? 1 : 0) * 2 + (a !== b ? 1 : 0) * 4;
}
function both(a, b, c) {
  return (a < b && b < c ? 1 : 0) + (a < b || b < c ? 1 : 0) * 2;
}
function reused(a, b) {
  const test = a < b, number = test ? 1 : 0;
  return test ? number + 5 : number - 5;
}
function sum64(list) {
  let high = 0, low = 0;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const l = (low + list[i + 1]) | 0;
    high = (high + list[i] + carry(l, low)) | 0;
    low = l;
  }
  return [high, low].join();
}
function count(list, limit) {
  let n = 0, m = 0, other = 5;
  for (const v of list) {
    n += v < limit ? 1 : 0;
    m = (m << 1) ^ (v >= limit ? 1 : 0);
    other = v === limit ? 0 : 1;
  }
  return [n, m, other].join();
}
function two(a, b) {
  let x, y;
  if (a < b) {
    x = 1;
    y = 0;
  } else {
    x = 0;
    y = 1;
  }
  return x * 10 + y;
}
function kept(a, b, v) {
  let x, y;
  if (a < b) {
    x = 1;
    y = v;
  } else {
    x = 0;
    y = v;
  }
  return [x, y].join();
}
const ints = [0, 1, -1, 2147483647, -2147483648, 65536, -65536, 12345];
const numbers = [...ints, 0.5, -0.5, NaN, -0, Infinity, -Infinity, 4294967295, 2 ** 53, 2 ** 31];
const anything = [...numbers, "a", "1", "", undefined, null, true, false, 1n, -1n, 2n ** 70n, { valueOf() { return 1; } }, [2]];
const lines = [];
for (const a of ints) lines.push(ints.map((b) => [carry(a, b), borrow(a, b), reused(a, b), two(a, b), kept(a, b, 7)].join(" ")).join(" | "));
for (const a of numbers) lines.push(numbers.map((b) => [carry(a, b), borrow(a, b), below(a, b), notBelow(a, b), atMost(a, b), above(a, b), same(a, b), both(a, b, 1), reused(a, b), two(a, b), kept(a, b, a)].join(" ")).join(" | "));
for (const a of anything) lines.push(anything.map((b) => [below, notBelow, atMost, above, same, two].map((f) => { try { return f(a, b); } catch (error) { return error.name; } }).join(" ")).join(" | "));
const words = [];
for (let i = 0, x = 12345; i < 400; i++) words.push((x = (Math.imul(x, 1664525) + 1013904223) | 0));
lines.push(sum64(words), count(words, 0), count(words.map((v) => v / 3), 0.25), count(words, words[77]), count(["b", "a", "c"], "b"));
console.log(lines.join("\n"));
