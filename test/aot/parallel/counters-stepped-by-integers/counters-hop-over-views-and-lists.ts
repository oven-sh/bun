function hop(view: Uint8Array, start: number): number {
  let n = 0;
  for (let i = 1; i <= 7; i++) {
    let j = start;
    while (view[j] !== 255) { n = (n + view[j]) | 0; j += i; }
  }
  return n;
}
function list(values: number[], start: number): number {
  let n = 0;
  for (let i = 1; i <= 7; i++) {
    let j = start;
    while (values[j] !== undefined) { n = (n + values[j]) | 0; j += i; }
  }
  return n;
}
function bounded(view: Uint8Array, start: number): number {
  let n = 0;
  const size = view.length;
  for (let i = 1; i <= 7; i++) for (let j = start; j < size; j += i) n = (n + view[j]) | 0;
  return n;
}
const view = new Uint8Array(4020);
for (let k = 0; k < 4000; k++) view[k] = k % 250;
for (let k = 4000; k < 4020; k++) view[k] = 255;
const values: number[] = [];
for (let k = 0; k < 4000; k++) values.push(k % 250);
for (const start of [0, 3, 3999, 4000, -2, -2147483648 + 2147481000]) console.log(start, hop(view, start), bounded(view, start));
for (const start of [0, 3, 3999, 4000, 5000, 2147483647, 4294967295, 1.5, -1]) console.log(start, list(values, start), bounded(view, start));
console.log(bounded(view, NaN), bounded(view, 2.5), bounded(view, -0), bounded(new Uint8Array(0), 0));
