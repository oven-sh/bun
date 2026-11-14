// Accesses to an array of either kind lie among others that are told apart too: each runs once.
const out = [];
async function rows(a, rows, n) {
  let s = 0.5,
    c = 0,
    d = 0;
  const q = [];
  for (let i = n; i-- > 0; ) {
    for (let j = 0; j < a.length; j++) {
      rows[i][j] += rows[j][i];
      if (a[j + 1] & 1) q.push(j);
      if (j % 3 === 1) c += 2;
    }
    if (a[i + 1] <= a[i + 1]) c++;
  }
  return [s, c, d, q.join()];
}
function step(a, b, k) {
  a[k] = a[k] + 1;
  b[k] += a[k];
  if (a[k] <= b[k]) a[k + 1] += 2;
  return a[k] + b[k] + a.length + b.length;
}
function exchange(a, b, k, o) {
  const x = a[k], y = b[k];
  a[k] = y + 1;
  b[k] = x + 1;
  o.count += a[k] === b[k] ? 1 : 2;
  a[k + 1] = b[k + 1] = o.count++;
  return a.indexOf(x) + b.indexOf(y) + a.slice(1).length;
}
const list = n => Array.from({ length: n }, (_, i) => (i * 7) & 15);
const makers = [() => list(6), () => new Int32Array(list(6)), () => new Float64Array(list(6)), () => list(6).map(x => x + 0.5)];
(async () => {
  for (let t = 0; t < 4; t++) {
    for (const make of makers) {
      for (const other of makers) {
        const a = make(), b = other(), o = { count: 1 };
        let s = 0;
        for (let k = 0; k < 5; k++) s += step(a, b, k) + exchange(a, b, k, o) + step(b, a, k);
        out.push([s, o.count, Array.from(a).join(), Array.from(b).join()].join(" "));
        const table = [other(), make(), other(), make(), list(6), other()];
        try {
          out.push(String(await rows(make(), table, 4)) + " " + table.map(r => Array.from(r).join()).join("|"));
        } catch (e) {
          out.push(e.constructor.name);
        }
      }
    }
    for (const a of ["text", ["ab", "cd", "ef"], [1n, 2n], [1, , 3]]) {
      for (const table of [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], ["ab", "cd", "ef"], [Object.freeze([1, 2, 3]), [4, 5, 6], new Int8Array(3)]]) {
        try {
          out.push(String(await rows(a, table, 3)) + " " + table.map(r => Array.from(r).join()).join("|"));
        } catch (e) {
          out.push(e.constructor.name);
        }
      }
    }
  }
  for (const line of out) console.log(line);
})();
