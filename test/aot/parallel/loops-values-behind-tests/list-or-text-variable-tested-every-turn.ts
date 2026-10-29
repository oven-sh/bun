// A variable of the module holds a list or a text. Every turn reads it and asks which, and the loop first runs ahead of the store, behind a flag.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (!isOpen) {
      sum += j;
      continue;
    }
    const now = either;
    if (typeof now === "string") sum = mix(sum, now.length + now.charCodeAt(j % now.length));
    else sum = mix(sum, now[j % 3]! + now.length);
    if ((j & 7) === 7) either = j & 8 ? "text" + j : [j, j + 1, j + 2];
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
let either: string | number[] = [process.argv.length, 2, 3];
isOpen = true;
console.log(work(40), work(40));
