const keys = new Int32Array([0, -1, 3, 5, 2147483647, -2147483648, 2, 9, 1]);
function walk(list, n) {
  let total = 0, seen = "";
  for (let t = 0; t < keys.length; t++) {
    let k = keys[t];
    if (k >= 0 && k < list.length) {
      list[k] = list[0];
    }
  }
  return total + "/" + seen;
}
for (const n of [0, 3, 6, 100]) { const list = Array.from({ length: 9 }, (_, i) => ({ v: i })); let said; try { said = walk(list, n); } catch (e) { said = e.constructor.name; } console.log(n, said, list.length, String(Array.from(list))); }
