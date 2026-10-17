// Captured variables must be heap-allocated when the inner function outlives the call that created it.
const saved: ((k: number) => number)[] = [];
function stored(n: number): number { //! heap
  let total = n;
  function add(k: number): number { if (k > 0) { total += k; return add(k - 1); } return total; }
  saved.push(add);
  return add(2);
}
function returned(n: number): (k: number) => number { //! heap
  let total = n;
  function add(k: number): number { if (k > 0) { total += k; return add(k - 1); } return total; }
  add(1);
  return add;
}
function throughAnother(n: number): number { //! heap
  let total = n;
  function add(k: number): number { if (k > 0) { total += k; return add(k - 1); } return total; }
  saved.push(k => add(k) + 1);
  return add(1);
}
function handedToBuiltin(list: number[]): number { //! heap
  let total = 0;
  function add(k: number): void { if (k > 0) { total += k; add(k - 2); } }
  list.forEach(add);
  add(3);
  return total;
}
async function suspended(n: number): Promise<number> { //! heap
  let total = n;
  function add(k: number): void { if (k > 0) { total += k; add(k - 1); } }
  add(2);
  await null;
  add(3);
  return total;
}
function* yielded(n: number): Generator<number> { //! heap
  let total = n;
  function add(k: number): void { if (k > 0) { total += k; add(k - 1); } }
  add(2);
  yield total;
  add(3);
  yield total;
}
let out = "";
const kept: ((k: number) => number)[] = [];
for (let i = 0; i < 200; i++) {
  const a = stored(i), r = returned(i), c = throughAnother(i), d = handedToBuiltin([i % 5, 4, 1]);
  kept.push(r);
  let g = 0;
  for (const y of yielded(i)) g += y;
  if (i % 50 === 0) out += a + "|" + r(2) + "|" + c + "|" + d + "|" + g + "\n";
}
let later = 0;
for (let i = 0; i < saved.length; i++) later += saved[i](1);
for (let i = 0; i < kept.length; i++) later += kept[i](1);
console.log(out + later);
suspended(5).then(v => console.log("async", v));
