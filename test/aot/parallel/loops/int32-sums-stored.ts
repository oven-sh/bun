// Sums of int32s stored back into arrays: made in integers where no hole comes between, with overflow to doubles, holes, -0 and stores of the same iteration.
function bump(list: number[]): number[] {
  for (let i = 0; i < list.length; i++) list[i] = list[i] + 1;
  return list;
}
function addRows(a: number[], b: number[], c: number[]): number[] {
  for (let i = 0; i < a.length; i++) c[i] = a[i] + b[i] - 3;
  return c;
}
function differences(a: number[], out: number[]): number[] {
  for (let i = 0; i + 1 < a.length; i++) out[i] = a[i + 1] - a[i];
  return out;
}
function running(a: number[]): number[] {
  for (let i = 1; i < a.length; i++) a[i] = a[i] + a[i - 1];
  return a;
}
function twice(a: number[], b: number[]): number[] {
  for (let i = 0; i < a.length; i++) {
    b[i] = a[i] + a[i];
    a[i] = b[i] - a[i];
  }
  return b;
}
function relax(d: number[][], k: number): void {
  const n = d.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
}
function cube(a: number[][][]): void {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) for (let k = 0; k < a[i][j].length; k++) a[i][j][k] = a[i][j][k] + 1;
}
// What is read behind the store of the iteration does not run the iteration again at a hole.
function stepAndSum(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    a[i] = a[i] + 1;
    sum += b[i] * 2;
  }
  return sum;
}
function stepAndCopy(a: number[], b: number[], c: number[]): void {
  for (let i = 0; i < a.length; i++) {
    c[i] = a[i] - b[i];
    a[i] = a[i] + c[i];
  }
}
const ints = (): number[] => Array.from({ length: 29 }, (_, i) => ((i * 37) % 19) - 9);
const large = (): number[] => Array.from({ length: 29 }, (_, i) => (i & 1 ? 2147483647 - i : -2147483648 + i));
const doubles = (): number[] => Array.from({ length: 29 }, (_, i) => ((i * 7) % 13) / 4);
const zeros = (): number[] => Array.from({ length: 29 }, (_, i) => (i & 1 ? -0 : 0));
const holes = (): number[] => {
  const list = ints();
  delete list[5];
  delete list[21];
  return list;
};
const short = (): number[] => ints().slice(0, 13);
const lines: string[] = [];
const say = (label: string, list: number[]) => lines.push(label + " " + list.length + " " + list.map(x => (Object.is(x, -0) ? "-0" : String(x))).join(" "));
const makes = [ints, large, doubles, zeros, holes, short];
for (const make of makes) {
  say("bump", bump(make()));
  say("running", running(make()));
  const same = make();
  say("same", addRows(same, same, same));
  for (const other of makes) {
    say("addRows", addRows(make(), other(), ints()));
    say("onto", addRows(make(), other(), other()));
    say("empty", addRows(make(), other(), []));
    say("differences", differences(make(), other()));
    const stepped = make();
    lines.push(String(stepAndSum(stepped, other())));
    say("stepped", stepped);
    const copied = make();
    const into = ints();
    stepAndCopy(copied, other(), into);
    say("copied", copied);
    say("into", into);
    const b = other();
    const a = make();
    say("twice", twice(a, b));
    say("twice a", a);
    const rows = [make(), other(), make(), other(), ints(), holes()].map(row => row.slice(0, 6));
    for (let k = 0; k < 6; k++) relax(rows, k);
    for (const row of rows) say("relax", row);
    const nest = [[make(), other()], [other(), make()]];
    cube(nest);
    say("cube", nest[1][0]);
    say("cube", nest[1][1]);
  }
}
let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
console.log(lines.filter((_, i) => i % 19 === 0).join("\n"));
