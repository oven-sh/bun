function Shelf(n) { this.n = n; this.top = null; }
function put(shelf, i) { shelf.top = { i, text: "top" + i }; shelf.side = [i, "side" + i]; }
const shelves = [];
for (let i = 0; i < 40; i++) shelves.push(new Shelf(i));
Bun.gc(true);
let sum = 0;
for (let round = 0; round < 30; round++) {
  for (let i = 0; i < shelves.length; i++) put(shelves[i], round * 100 + i);
  const junk = []; for (let k = 0; k < 2000; k++) junk.push({ k, s: "j" + k });
  if (round % 5 === 0) Bun.gc(true);
  for (const shelf of shelves) sum += shelf.top.i + shelf.side[0] + shelf.top.text.length + shelf.side[1].length;
}
console.log(sum, Object.keys(shelves[7]).join());
