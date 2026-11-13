const keys = new Int32Array([0, -1, 3, 5, 2147483647, -2147483648, 2, 9, 1]);
function walk(list, n) {
  let total = 0, seen = "";
  for (let t = 0; t < keys.length; t++) {
    let k = keys[t];
    if (0 <= k && list.length > k) {
      seen += String(list[k]) + ',';
    }
  }
  return total + "/" + seen;
}
for (const n of [0, 3, 6, 100]) { const list = [1, , 3, , 5]; let said; try { said = walk(list, n); } catch (e) { said = e.constructor.name; } console.log(n, said, list.length, String(Array.from(list))); }
