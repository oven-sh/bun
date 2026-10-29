// A variable of the module holds an array or a typed array. Every turn reads it and an element of it. Some turns store another one, resize the buffer, or take the buffer away.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
let either: number[] | Float64Array = [1, 2, 3, 4, 5, 6, 7, 8];
function tracking(i: number): Float64Array {
  return new Float64Array(new ArrayBuffer(64, { maxByteLength: 128 })).fill(i);
}
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = either[j & 7];
    sum = mix(sum, (e === undefined ? -1000 : e) + either.length);
    if ((j & 7) !== 7) continue;
    const way = (from + j) % 5;
    if (way === 0) either = tracking(from);
    else if (way === 1) either = [from, j, 0.5];
    else if (either instanceof Float64Array && way === 2) (either.buffer as ArrayBuffer).detached || (either.buffer as ArrayBuffer).resize(16);
    else if (either instanceof Float64Array && way === 3) (either.buffer as ArrayBuffer).detached || (either.buffer as ArrayBuffer).transfer();
    else if (Array.isArray(either)) either.length = 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 48));
console.log(total);
