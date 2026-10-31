// `xs.filter(f)` and `xs.map(g)` of numbers, each alone, in functions that run often: where the text of the built-in would be copied in, the traversal of chains
// comes in its place: it knows how long the result can get and which storage holds what the callback returns.
// STATISTIC: ArrayChainsFused >= 3
// The traversal counts in whole numbers.
// STATISTIC: ValuesInDouble <= 240
function kept(xs: number[], least: number): number[] {
  return xs.filter(x => x > least);
}
function doubled(xs: number[]): number[] {
  return xs.map(x => x * 2);
}
function halves(xs: number[]): number[] {
  return xs.map(x => x / 2);
}
function texts(xs: number[]): string[] {
  return xs.map(x => "n" + x);
}

const n = process.argv.length & 1;
const whole = [n + 1, 2, 3, 4, 5, 6, 7, 8];
const fractions = [n + 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
const holey = [n + 1, , 3, , 5] as number[];
let total = 0;
let last = "";
for (let k = 0; k < 20000; k++) {
  const a = kept(whole, k & 7);
  const b = kept(fractions, k & 3);
  const c = doubled(whole);
  const d = halves(whole);
  const e = texts(a);
  total += a.length + (a[0] ?? -1) + b.length + b[b.length - 1]! + c[k & 7]! + d[k & 7]! + e.length;
  if (k % 5000 === 0) last += JSON.stringify([a, b, c, d, e, kept(holey, 2), doubled(holey), Object.keys(doubled(holey))]) + "\n";
}
console.log(total);
console.log(last);

// The callback changes the list that is walked, throws in the middle, or is no function.
function changing(): string {
  const list = [1, 2, 3, 4, 5, 6];
  const shorter = list.filter(x => {
    if (x === 2) list.length = 4;
    return x > 1;
  });
  const longer = [1, 2, 3].map((x, i, all) => {
    if (i === 0) all.push(9);
    return x * 2;
  });
  let thrown = "";
  try {
    [1, 2, 3].filter(x => {
      if (x === 2) throw new RangeError("two");
      return true;
    });
  } catch (error) {
    thrown = String(error);
  }
  try {
    [1].filter(undefined as unknown as () => boolean);
  } catch (error) {
    thrown += " " + (error as Error).name;
  }
  return JSON.stringify([shorter, longer, list]) + " " + thrown;
}
let text = "";
for (let k = 0; k < 300; k++) text = changing();
console.log(text);
