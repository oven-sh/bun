// The list is an array or one of two typed arrays, and a loop that runs often reads two elements a turn. One turn cuts the array, or takes the buffer of the typed array away.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(list: number[] | Float64Array | Uint8Array, at: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) {
      if (Array.isArray(list)) list.length = 1;
      else (list.buffer as ArrayBuffer).transfer();
    }
    const a = list[j % 3];
    const b = list[(j + 1) % 3];
    sum = mix(sum, (a === undefined ? -1000 : a) + (b === undefined ? -500 : b));
  }
  return mix(sum, list.length);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 3 === 0 ? [i, i + 1, i + 2] : i % 3 === 1 ? new Float64Array([i, i + 0.5, i + 2]) : new Uint8Array([i, i + 1, i + 2]), i % 250, 200));
console.log(total);
