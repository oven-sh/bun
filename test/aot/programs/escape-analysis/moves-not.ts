// Closures that must be heap-allocated from the start: another closure still refers to them, or another function creates them.
const saved: ((x: number) => void)[] = [];
function each(list: number[], f: (x: number) => void): void { for (let i = 0; i < list.length; i++) { f(list[i]); if (list[i] > 1e9) each(list, f); } }
function madeByInner(k: number): number { //! heap
  let n = 0;
  function inner(d: number): void { if (d > 0) { saved.push(x => { n += x; }); n += d; inner(d - 1); } }
  inner(k);
  saved[saved.length - 1](10);
  return n;
}
function outlivesTheMove(list: number[], keep: boolean): number { //! heap
  let n = 0;
  const add = (x: number): void => { n += x; };
  each(list, add);
  if (keep) saved.push(x => { n += x * 10; });
  each(list, add);
  if (keep) saved[saved.length - 1](1);
  return n;
}
const data = [1, 2, 3];
let out = "";
for (let i = 0; i < 200; i++) {
  const a = madeByInner(i % 4 + 1), b = outlivesTheMove(data, i % 3 === 0);
  if (i % 40 === 0 || i < 4) out += a + "|" + b + "\n";
  if (saved.length > 50) saved.length = 0;
}
console.log(out);
