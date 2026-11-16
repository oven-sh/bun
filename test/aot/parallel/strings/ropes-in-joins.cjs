// Lists of ropes are joined without resolving them: of any depth, length and width, in lists of any length.
let seed = 11, wrong = 0, hash = 0;
const random = n => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), (seed >> 8) % n);
const long = "abcdefghijklmnopqrstuvwxyz".repeat(30);
const piece = wide => (wide && random(20) === 0 ? "Ж" + random(9) : random(5) === 0 ? "" : random(4) === 0 ? long.slice(random(700), 701 + random(60)) : random(3) === 0 ? String(random(100000)) : "é" + random(10));
function left(n, wide) { let s = piece(wide); for (let i = 1; i < n; i++) s = s + piece(wide); return s; }
function right(n, wide) { let s = piece(wide); for (let i = 1; i < n; i++) s = piece(wide) + s; return s; }
function both(n, wide) { return n < 2 ? piece(wide) : both(n >> 1, wide) + both(n - (n >> 1), wide); }
for (const wide of [false, true]) for (const count of [1, 2, 3, 7, 31, 33, 80]) for (const separator of ["", ",", "--", "Ж"]) for (let k = 0; k < 6; k++) {
  const list = [];
  let expected = "";
  for (let i = 0; i < count; i++) {
    const text = [left, right, both][random(3)](1 + random([3, 6, 12, 50][k & 3]), wide);
    list.push(random(5) === 0 ? text.slice(random(3)) : text);
    expected = i ? expected.concat(separator, list[i]) : list[0];
  }
  const joined = list.join(separator);
  if (joined !== expected || joined.length !== expected.length) wrong++;
  for (let i = 0; i < joined.length; i += 7) hash = (hash * 31 + joined.charCodeAt(i)) | 0;
  if (String(list) !== list.join()) wrong++;
  if (`${[list, 1, [list[0], "x" + k]]}` !== list.join() + ",1," + list[0] + ",x" + k) wrong++;
}
console.log(wrong, hash);
