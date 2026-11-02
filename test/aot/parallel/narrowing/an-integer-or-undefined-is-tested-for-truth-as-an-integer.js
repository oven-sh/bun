const walls = Uint8Array.from({ length: 64 }, (_, k) => (k % 9 === 4 ? 1 : 0));
function flood(start) {
  const seen = new Uint8Array(64);
  const stack = [start];
  let filled = 0;
  while (stack.length) {
    const at = stack.pop();
    if (seen[at] || walls[at]) continue;
    seen[at] = 1;
    filled++;
    const x = at % 8;
    if (x > 0) stack.push(at - 1);
    if (x < 7) stack.push(at + 1);
    if (at >= 8) stack.push(at - 8);
    if (at < 56) stack.push(at + 8);
  }
  return filled;
}
let filled = 0;
for (let i = 0; i < 40; i++) filled += flood(i & 3);
console.log(filled);

function truths(view, positions) {
  let text = "";
  for (const at of positions) text += view[at] ? "1" : "0";
  return text;
}
const positions = [0, 1, 2, 3, 4, 5, -1, 6, 100, 1.5, -0, NaN, Infinity, 4294967296, 2147483648];
console.log(truths(Uint8Array.of(0, 1, 255, 0, 128, 7), positions));
console.log(truths(Int8Array.of(0, -1, 127, 0, -128, 7), positions));
console.log(truths(Uint16Array.of(0, 1, 65535, 0, 256, 7), positions));
console.log(truths(Int32Array.of(0, -1, 2147483647, 0, -2147483648, 65536), positions));
console.log(truths(Uint32Array.of(0, 1, 4294967295, 0, 2147483648, 65536), positions));

function unitsThatCount(text) {
  let count = 0;
  for (let at = 0; at < text.length + 3; at++) if (text.codePointAt(at)) count++;
  return count;
}
console.log(unitsThatCount("a\0b\0\0c"), unitsThatCount(""), unitsThatCount("\u{1f600}\0"));

function listed(list, upTo) {
  let text = "";
  for (let at = -1; at < upTo; at++) text += list[at] ? "1" : "0";
  return text;
}
console.log(listed([0, 1, 2, 0, -1], 8));
console.log(listed([0, 4294967296, 8589934592, 0, -4294967296, 1099511627776], 8));
console.log(listed([0, , 3, , 0, 5], 8));

const wide = new Map([["none", 0], ["low word is zero", 4294967296], ["also", -8589934592], ["one", 1]]);
function found(names) {
  let text = "";
  for (const name of names) text += wide.get(name) ? "1" : "0";
  return text;
}
console.log(found(["none", "low word is zero", "missing", "also", "one"]));

function firstOrNull(list, at) {
  const value = at < list.length ? list[at] : null;
  return value ? "yes" : "no";
}
console.log(firstOrNull([0, 5], 0), firstOrNull([0, 5], 1), firstOrNull([0, 5], 2));
