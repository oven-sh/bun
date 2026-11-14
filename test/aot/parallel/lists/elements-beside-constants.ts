// Elements of lists of numbers that a written number is added to or taken from: fractions, whole numbers, holes, the rows of an edit distance, sums beyond int32.
const said: string[] = [];
const show = (x: unknown): string => (Array.isArray(x) ? "[" + Array.from(x, (y, i) => (i in x ? show(y) : "_")).join() + "]#" + x.length : Object.is(x, -0) ? "-0" : String(x));
function distance(s: string, t: string): number {
  let a: number[] = new Array<number>(t.length + 1).fill(0);
  for (let j = 0; j <= t.length; j++) a[j] = j;
  for (let i = 1; i <= s.length; i++) {
    const b: number[] = [i];
    for (let j = 1; j <= t.length; j++) b[j] = Math.min(a[j] + 1, b[j - 1] + 1, a[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    a = b;
  }
  return a[t.length];
}
function weighted(s: string, t: string): number {
  let a: number[] = [];
  for (let j = 0; j <= t.length; j++) a.push(j * 0.5);
  for (let i = 1; i <= s.length; i++) {
    const b: number[] = [i * 0.5];
    for (let j = 1; j <= t.length; j++) b[j] = Math.min(a[j] + 0.5, 0.5 + b[j - 1], a[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 0.75));
    a = b;
  }
  return a[t.length];
}
function rising(first: number, n: number): number[] {
  const list: number[] = [first];
  for (let i = 1; i < n; i++) list[i] = list[i - 1] + 1073741823;
  return list;
}
function falling(first: number, n: number): number[] {
  const list: number[] = [first];
  for (let i = 1; i < n; i++) list[i] = list[i - 1] - 1;
  return list;
}
function halves(n: number): number[] {
  const list: number[] = [0];
  for (let i = 1; i < n; i++) list[i] = 1 + list[i - 1] / 2;
  return list;
}
function withHoles(n: number): number[] {
  const list: number[] = new Array<number>(n);
  for (let i = 0; i < n; i += 2) list[i] = i;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(list[i] + 1);
  return out;
}
function beyond(n: number): number[] {
  const list: number[] = [1, 2.5, 3];
  const out: number[] = [];
  for (let i = -1; i < n; i++) out.push(list[i] + 2, 2 + list[i], list[i] - 0.25);
  return out;
}
function signs(): number[] {
  const list: number[] = [0, -0, 1, -1];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) out.push(list[i] + 0, list[i] + -0, -0 + list[i], list[i] - 0);
  return out;
}
for (const [s, t] of [["kitten", "sitting"], ["", "abc"], ["abc", ""], ["intention", "execution"], ["same", "same"]]) said.push(String(distance(s, t)), String(weighted(s, t)));
said.push(show(rising(1, 6)), show(rising(0.5, 6)), show(rising(-2147483648, 6)), show(falling(2, 6)), show(falling(0.25, 6)), show(falling(-2147483647, 5)), show(halves(8)), show(withHoles(7)), show(beyond(5)), show(signs()));
console.log(said.join("\n"));
