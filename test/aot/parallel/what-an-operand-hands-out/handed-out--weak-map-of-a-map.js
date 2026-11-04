const cells = []; const first = new Map(); for (let i = 0; i < 40; i++) { cells.push({ id: i }); first.set(cells[i], ["t" + i]); }
const map = new WeakMap(first);
console.log(map.get(cells[7]).length, map.get(cells[7])[0].length);
