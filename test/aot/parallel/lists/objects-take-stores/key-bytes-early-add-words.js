const keys = new Int32Array([0, -1, 3, 5, 2147483647, -2147483648, 2, 9, 1]);
function walk(list, n) {
  let total = 0, seen = "";
  for (let t = 0; t < keys.length; t++) {
    let k = keys[t];
    if (k < 0) continue; if (k >= list.length) continue; {
      list[k] += 1; seen += list[k] + ',';
    }
  }
  return total + "/" + seen;
}
for (const n of [0, 3, 6, 100]) { const list = new Uint8Array([1, 2, 3, 250, 5]); let said; try { said = walk(list, n); } catch (e) { said = e.constructor.name; } console.log(n, said, list.length, String(Array.from(list))); }
