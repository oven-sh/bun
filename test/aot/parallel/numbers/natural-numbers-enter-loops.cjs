// What enters a loop as the index of elements: an int32 from zero up in either form, negative, a fraction, too large, not a number, an object that counts its conversions.
const list = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
const other = [2.5, 7, 1, 8, 2, 8, 1, 8, 2, 8, 4, 5];
function sumFrom(a, i, n) {
  let s = 0;
  while (--n >= 0) s += a[i++];
  return [s, i].join();
}
function copyFrom(a, i, b, j, n) {
  for (; n > 0; n--) b[j++] = a[i++];
  return [b.join(), i, j].join(" ");
}
function find(a, from, value) {
  for (let i = from; i < a.length; i++) if (a[i] === value) return i;
  return -1;
}
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : String(v));
let conversions = 0;
const starts = [0, 1, 11, 12, 2147483647, 2147483648, 4294967295, 4294967296, -1, -2147483648, 0.5, 3.0000000001, -0, NaN, Infinity, -Infinity, undefined, null, "2", true, 9007199254740992, { valueOf() { conversions++; return 4; } }, 5n, Symbol("s")];
const halves = [0.5, 1.5, 2.5].map(v => v * 2);
for (let round = 0; round < 80; round++) {
  sumFrom(list, round % 4, 5);
  copyFrom(list, round % 3, [0, 0, 0, 0, 0, 0, 0, 0], round % 2, 4);
  find(list, round % 5, 9);
}
function attempt(run) {
  try {
    return show(run());
  } catch (e) {
    return e.constructor.name;
  }
}
for (const start of starts.concat(halves)) {
  const name = typeof start === "object" && start ? "counting" : show(start);
  console.log(name, attempt(() => sumFrom(list, start, 3)), attempt(() => sumFrom(other, start, 3)), attempt(() => copyFrom(list, start, [0, 0, 0, 0], 1, 2)), attempt(() => copyFrom(list, 1, [0, 0, 0, 0], start > 100 ? 2 : start, 2)), attempt(() => find(list, start < -100 ? -3 : start, 5)), attempt(() => sumFrom(list, 2, start > 100 ? 3 : start)));
}
console.log(conversions);
