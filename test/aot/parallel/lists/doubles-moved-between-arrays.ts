// A double read off an array for nothing but a store into another: into arrays of doubles, of int32s, of any values, past their ends, and into the array itself.
function matrix(n: number, scale: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(((i * 7 + j * 3) % 11) / scale);
    rows.push(row);
  }
  return rows;
}

function transpose(from: number[][], to: number[][]): void {
  for (let i = 0; i < from.length; i++) for (let j = 0; j < from[i].length; j++) to[j][i] = from[i][j];
}

function shift(list: number[], by: number): void {
  for (let i = 0; i < list.length - by; i++) list[i] = list[i + by];
}

function gather(list: number[], keys: number[], to: number[]): void {
  for (let i = 0; i < keys.length; i++) to[i] = list[keys[i]];
}

// Past the end of `list` there is undefined.
function copyPast(list: number[], to: number[], n: number): void {
  for (let i = 0; i < n; i++) to[i] = list[i];
}

function spread(list: number[], to: (number | string)[]): void {
  for (let i = 0; i < list.length; i++) to[i * 2] = list[i];
}

const said: string[] = [];
for (const [n, scale, otherScale] of [[4, 4, 4], [4, 4, 1], [4, 1, 4], [3, 2, 1], [5, 1, 1]]) {
  const from = matrix(n, scale);
  const to = matrix(n, otherScale);
  transpose(from, to);
  said.push(to.join("|"));
  transpose(to, from);
  said.push(from.join("|"));
  shift(from[1], 1);
  said.push(from[1].join());
  const picked: number[] = [];
  gather(from[0], [2, 0, 1, 9, 2, -1, 0.5], picked);
  said.push(picked.join() + picked.length);
  const any: (number | string)[] = ["a", "b", "c"];
  spread(from[2], any);
  said.push(any.join());
}
const past: number[] = [9.5, 9.5, 9.5, 9.5, 9.5, 9.5];
copyPast(matrix(4, 4)[1], past, 6);
said.push(past.join() + past[5] + (5 in past));
const pastInts: number[] = [9, 9, 9, 9, 9, 9];
copyPast(matrix(4, 4)[1], pastInts, 6);
said.push(pastInts.join() + pastInts[4] + (4 in pastInts));
const growing: number[][] = [[], [], []];
transpose(matrix(3, 8), growing);
said.push(growing.join("|"));
console.log(said.join("\n"));
