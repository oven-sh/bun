function run(view: Uint8Array, start: number): number { let t = start; for (let i = 0; i < view.length; i++) { if (view[i] === 200) break; t += view[i]; } return t; }
function byCounter(start: number, n: number, stop: number): number {
  let sum = start * 1;
  const end = n | 0, halt = stop | 0;
  for (let i = 0; i < end; i++) { if (i === halt) break; sum += i & 3; }
  return sum;
}
const unseen = (0, eval)("(x) => x");
const view = new Uint8Array(40);
for (let i = 0; i < 40; i++) view[i] = i % 100;
view[0] = 200;
let first = 0, second = 0;
for (let turn = 0; turn < 300; turn++) {
  if (Object.is(run(view, unseen(-0)), -0)) first++;
  if (Object.is(byCounter(unseen(-0), unseen(64), unseen(0)), -0)) second++;
}
console.log(first, second, 1 / run(view, unseen(-0)), 1 / byCounter(unseen(-0), unseen(64), unseen(0)));
