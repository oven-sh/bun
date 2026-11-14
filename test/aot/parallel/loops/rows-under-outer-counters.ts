// A row that is read under the counter of the loop around, in an inner loop that the same counter bounds.
function below(rows: number[][]): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < i; j++) sum += rows[i][j];
  return sum;
}
function difference(rows: number[][], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) sum += rows[i][j] - rows[j][i];
  return sum;
}
function above(rows: number[][], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = n; j > i; j--) sum += rows[i][j - 1] * (j + i);
  return sum;
}
function swap(rows: number[][], n: number): string {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const kept = rows[i][j];
      rows[i][j] = rows[j][i];
      rows[j][i] = kept;
    }
  }
  return rows.map(row => row.join()).join("|");
}
function replace(rows: number[][], n: number, at: number): string {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      sum += rows[i][j];
      if (i + j === at) rows[i] = [100, 200, 300, 400, 500];
    }
  }
  return sum + " " + rows.map(row => row.join()).join("|");
}
function drop(rows: (number[] | undefined)[], n: number, at: number): string {
  let sum = 0;
  try {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        sum += rows[i]![j];
        if (i + j === at) rows[i] = undefined;
      }
    }
  } catch (error) {
    return sum + " " + (error as Error).constructor.name;
  }
  return String(sum);
}
function shrink(rows: number[][], n: number): string {
  let sum = 0;
  try {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        sum += rows[i][j] ?? 1000;
        if (sum > 20) rows.length = i;
      }
    }
  } catch (error) {
    return sum + " " + (error as Error).constructor.name;
  }
  return String(sum);
}
function three(cube: number[][][], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) for (let k = 0; k < j; k++) sum += cube[i][j][k] - cube[k][j][i];
  return sum;
}
const make = (n: number, scale: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i * 7 + j * 3) % 11 / scale));
for (const scale of [1, 4]) {
  console.log(below(make(5, scale)), difference(make(5, scale), 5), above(make(5, scale), 5), swap(make(5, scale), 5));
  for (const at of [1, 3, 4]) console.log(replace(make(5, scale), 5, at), drop(make(5, scale), 5, at));
  console.log(shrink(make(5, scale), 5), three(Array.from({ length: 4 }, (_, i) => make(4, scale + i)), 4));
}
const holed = make(5, 1);
delete holed[3][1];
console.log(below(holed), difference(holed, 5));
const short = make(5, 4);
short[2].length = 1;
console.log(below(short), difference(short, 4));
for (const n of [5, 6, 7]) {
  try {
    console.log(difference(make(5, 1), n));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
const texts = make(4, 1) as any[][];
texts[2][0] = "x";
texts[3] = "text" as any;
console.log(below(texts), difference(texts, 4));
let reads = 0;
const watched = make(4, 1);
Object.defineProperty(watched, 2, { get: () => { reads++; return [reads, reads * 2, reads * 3, 4]; } });
console.log(below(watched), difference(watched, 4), reads);
