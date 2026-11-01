const kept: unknown[][] = new Array(8).fill([]);
function numbers(i: number, a: boolean, b: boolean): number[] {
  return [i, ...(a ? [i + 1] : []), 7, ...(b ? [i + 2, i + 3] : []), 9];
}
function words(name: string, verbose: boolean, file: string | undefined): string[] {
  return ["run", ...(verbose ? ["--verbose"] : []), name, ...(file ? ["--file", file] : [])];
}
function pushed(i: number, a: boolean, b: boolean): number[] {
  const made = [i];
  if (a) made.push(i + 1);
  made.push(7);
  if (b) made.push(i + 2, i + 3);
  made.push(9);
  return made;
}
let sum = 0;
for (let i = 0; i < 200000; i++) {
  const first = numbers(i & 1023, (i & 1) === 0, (i & 2) === 0);
  const second = words("n", (i & 4) === 0, i & 8 ? "f" : undefined);
  const third = pushed(i & 1023, (i & 2) === 0, (i & 1) === 0);
  kept[i & 7] = i & 16 ? first : i & 32 ? second : third;
  sum = (sum + first.length + second.length * 3 + third.length * 5 + first[first.length - 1]! + third[1]!) | 0;
}
console.log(sum);
