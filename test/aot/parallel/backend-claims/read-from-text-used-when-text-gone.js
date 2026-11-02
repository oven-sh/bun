// The length and the characters of a text are read, nothing holds the text any more, a collection takes it away, other texts take its place, and only then is what was read put to use.
// The texts are made far down the stack and are held by small functions that call themselves, so that nothing left behind on the stack points at them when the collection looks.
function textOf(size, seed, base) {
  let text = "";
  for (let k = 0; k < size; k++) text += String.fromCharCode(base + ((seed + k * 7) % 26));
  return text;
}
function madeFarDown(depth, size, seed, base) {
  if (depth === 0) return textOf(size, seed, base);
  const text = madeFarDown(depth - 1, size, seed, base);
  return text;
}
const kept = [];
function collect(again, size, base) {
  if (again > 0) return collect(again - 1, size, base);
  Bun.gc(true);
  kept.length = 0;
  let sum = 0;
  for (let k = 0; k < 24; k++) {
    const other = textOf(size + (k % 3), k, base);
    sum += other.charCodeAt(other.length - 1);
    kept.push(other);
  }
  return sum;
}
function digested(again, size, seed, base) {
  if (again > 0) return digested(again - 1, size, seed, base);
  const text = madeFarDown(300, size, seed, base);
  let sum = 0;
  for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) % 1000000007;
  return "" + text.length + ":" + sum + " " + collect(1, size, base);
}
function ends(again, size, seed, base) {
  if (again > 0) return ends(again - 1, size, seed, base);
  const text = madeFarDown(300, size, seed, base);
  const first = text.charCodeAt(0);
  const last = text.charCodeAt(text.length - 1);
  const length = text.length;
  const between = collect(1, size, base);
  return first + " " + last + " " + length + " " + between;
}
function whereAsked(again, size, seed, base, isAsked) {
  if (again > 0) return whereAsked(again - 1, size, seed, base, isAsked);
  const text = madeFarDown(300, size, seed, base);
  const middle = text.charCodeAt(size >> 1);
  const length = text.length;
  const between = collect(1, size, base);
  if (isAsked) return length + between + middle;
  return between;
}
function onEveryTurn(again, size, seed, base) {
  if (again > 0) return onEveryTurn(again - 1, size, seed, base);
  const text = madeFarDown(300, size, seed, base);
  const length = text.length;
  const first = text.charCodeAt(0);
  let sum = 0;
  for (let turn = 0; turn < 3; turn++) sum += collect(1, size, base) + length + first;
  return sum;
}
for (const base of [97, 0x4e00]) {
  for (const size of [1, 2, 7, 8, 40, 255, 256, 1000, 4852, 20000]) {
    console.log(size, digested(1, size, 1, base));
    console.log(size, ends(1, size, 3, base));
    console.log(size, whereAsked(1, size, 4, base, true), whereAsked(1, size, 5, base, false));
    console.log(size, onEveryTurn(1, size, 6, base));
  }
}
