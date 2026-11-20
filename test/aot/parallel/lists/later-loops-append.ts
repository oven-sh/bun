// STATISTIC: StoresGrowingArrays >= 10
// Several loops fill one array under one counter: each of them appends.
function merge(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0, j = 0, n = 0;
  while (i < a.length && j < b.length) out[n++] = a[i]! < b[j]! ? a[i++]! : b[j++]!;
  while (i < a.length) out[n++] = a[i++]!;
  while (j < b.length) out[n++] = b[j++]!;
  return out;
}
function gaps(a: number[], skip: number): number[] {
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < a.length; i++) out[n++] = a[i]!;
  n += skip;
  for (let i = 0; i < a.length; i++) out[n++] = a[i]! * 2;
  n = 1;
  for (let i = 0; i < 3; i++) out[n++] = -1;
  return out;
}
function shortened(a: number[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < a.length; i++) out[n++] = a[i]!;
  out.length = 1;
  for (let i = 0; i < a.length; i++) out[n++] = i;
  return out;
}
function mixed(a: number[], text: string): unknown[] {
  const out: unknown[] = [];
  let n = 0;
  for (let i = 0; i < a.length; i++) out[n++] = a[i];
  for (let i = 0; i < a.length; i++) out[n++] = i === 2 ? text : a[i];
  for (let i = 0; i < a.length; i++) out[n++] = [i];
  return out;
}
const said: string[] = [];
for (const a of [[1, 4, 7, 9], [0.5, 2, -0, NaN], [], [5], [2 ** 31, -1, 3]])
  for (const b of [[2, 3, 8], [], [0.25, 1e21]]) {
    for (let turn = 0; turn < 3; turn++) said.push(JSON.stringify(merge(a, b)));
    said.push(JSON.stringify(gaps(a, 0)), JSON.stringify(gaps(a, 2)), JSON.stringify(shortened(a)), JSON.stringify(mixed(a, "t")));
  }
console.log(said.join("\n"));
