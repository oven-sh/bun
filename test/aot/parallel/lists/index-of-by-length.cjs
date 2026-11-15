// indexOf over objects, int32s, mixed numbers, holes and copy-on-write literals of 0 to 70 elements: a hit at each place, the first of several, and none.
const objects = [], lines = [];
function Node(i) { this.i = i; }
for (let i = 0; i < 80; i++) objects.push(new Node(i));
class Heap {
  constructor(list) { this.content = list; }
  place(x) { return this.content.indexOf(x); }
  from(x, start) { return this.content.indexOf(x, start); }
  has(x) { return this.content.includes(x); }
}
const makers = {
  objects: n => objects.slice(0, n),
  repeats: n => Array.from({ length: n }, (_, i) => objects[i % 9]),
  ints: n => Array.from({ length: n }, (_, i) => i),
  mixed: n => { const l = []; for (let i = 0; i < n; i++) l.push(i & 1 ? i : i + 0.5); return l; },
  holes: n => { const l = objects.slice(0, n); delete l[n >> 1]; delete l[1]; return l; },
  literal: n => { const l = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]; return n < 24 ? l.slice(0, n) : l; },
  texts: n => Array.from({ length: n }, (_, i) => "t" + i),
  values: n => Array.from({ length: n }, (_, i) => [undefined, null, true, NaN, -0, "x", 2n][i % 7]),
};
for (const [kind, make] of Object.entries(makers)) {
  for (let n = 0; n <= 70; n++) {
    const list = make(n), heap = new Heap(list), wanted = [objects[n], n, n - 1, -1, 0.5, -0, NaN, undefined, null, "t" + (n - 1), true, 2n];
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum = (sum * 31 + heap.place(list[i]) + heap.from(list[i], i) + heap.from(list[i], i - list.length) + (heap.has(list[i]) ? 3 : 0)) % 1000003;
    lines.push(kind + " " + n + " " + sum + " " + wanted.map(x => heap.place(x)).join());
  }
}
const big = makers.objects(77), heap = new Heap(big); let turns = 0;
for (let i = 0; i < 5000; i++) { const x = big[(i * 13) % 77]; turns += heap.place(x); if (i % 50 === 0) { big.push(big.shift()); } if (i % 70 === 0) big[i % 77] = objects[i % 80]; }
lines.push(turns, big.indexOf(objects[79]), [].indexOf(objects[0]), heap.place({}));
for (const line of lines) console.log(line);
