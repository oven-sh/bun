// `i + step <= limit; i += step`: the test looks at another sum than the step. Limits and starts of every kind, steps up and down, views that end in the middle of a step.
const bytes = new Uint8Array(37);
for (let i = 0; i < bytes.length; i++) bytes[i] = i * 7 + 1;
const buffer = Buffer.from(bytes);
const words = new Uint32Array([4294967295, 2147483647, 2147483648, 10, 0]);
const limits = [0, 1, 2, 3, 36, 37, 38, 36.5, -1, -0, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967296, "12", null, undefined, { valueOf() { return 9; } }];
const lines = [];

function pairs(view) {
  let s = 0;
  for (let i = 0; i + 2 <= view.length; i += 2) s = (s + view[i] * 256 + view[i + 1]) | 0;
  return s;
}
function shorts(b) {
  let s = 0;
  for (let i = 0; i + 2 <= b.length; i += 2) s = (s + b.readUInt16BE(i)) | 0;
  return s;
}
function quads(view, from) {
  let s = 0, i = from;
  for (; i + 4 <= view.length; i += 4) s = (s + view[i + 3]) | 0;
  return s + ":" + i;
}
function belowAnything(limit, from, most) {
  let n = 0, i = from;
  for (; i + 3 <= limit && n < most; i += 3) n++;
  return n + ":" + i;
}
function strictlyBelow(limit, from, most) {
  let n = 0, i = from;
  for (; i + 5 < limit && n < most; i += 5) n++;
  return n + ":" + i;
}
function downTo(limit, from, most) {
  let n = 0, i = from;
  for (; i - 2 >= limit && n < most; i -= 2) n++;
  return n + ":" + i;
}
function pastInt32(a, b, from) {
  const limit = words[a] + words[b];
  let s = 0, i = from;
  for (; i + 2 <= limit; i += 2) s = (s + (i & 15)) | 0;
  return s + ":" + i;
}
function stepIsNotTheSum(view) {
  let s = 0;
  for (let i = 0; i + 2 <= view.length; i += 3) s = (s + view[i + 1]) | 0;
  for (let i = 0; i + 3 <= view.length; i += 2) s = (s + view[i + 2]) | 0;
  return s;
}
function shrinks(length) {
  const list = [];
  for (let k = 0; k < length; k++) list.push(k);
  let s = 0;
  for (let i = 0; i + 2 <= list.length; i += 2) {
    s += list[i] + list[i + 1];
    if ((i & 7) === 4) list.length -= 3;
  }
  return s;
}

for (let round = 0; round < 3; round++) {
  lines.push(pairs(bytes), pairs(buffer), pairs([1, 2, 3, 4, 5]), pairs("abc"), shorts(buffer), shorts(buffer.subarray(1)), shorts(buffer.subarray(0, 1)));
  for (const from of [0, 1, 33, 34, 40, -4, 0.5]) lines.push(quads(bytes, from));
  for (const limit of limits) {
    lines.push(belowAnything(limit, 0, 20), belowAnything(limit, 2147483640, 20), belowAnything(limit, -7, 20), belowAnything(limit, 0.25, 20));
    lines.push(strictlyBelow(limit, 0, 20), strictlyBelow(limit, 4294967290, 20));
    lines.push(downTo(limit, 40, 30), downTo(limit, -2147483640, 30), downTo(limit, 2147483650, 30));
  }
  lines.push(pastInt32(1, 3, 2147483600), pastInt32(0, 3, 4294967200), pastInt32(0, 0, 8589934500), pastInt32(4, 4, 0), pastInt32(3, 4, 1));
  lines.push(stepIsNotTheSum(bytes), shrinks(40), shrinks(7), shrinks(0));
}
console.log(lines.join("\n"));
