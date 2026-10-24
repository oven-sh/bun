// What a spread copies beside the slots; loops over arrays; constructors; closures in fields.
type Pair = { a: number; b: number };
function make(a: number, b: number): Pair {
  return { a, b };
}
function copyAndAskForAnotherName(p: Pair): unknown {
  const c = { ...p };
  return (c as any).zz;
}
function copyAndRead(p: Pair): unknown {
  const c = { ...p };
  return c.a;
}
function copyAndHas(p: Pair): boolean {
  const c = { ...p };
  return "zz" in c;
}
function copyAndKeys(p: Pair): string {
  const c: Pair = { ...p };
  return Object.keys(c).join();
}

class Leaf {
  weight: number;
  constructor(weight: number) {
    this.weight = weight;
  }
}
class Crate {
  size: number;
  handler: () => number;
  constructor(size: number) {
    this.size = size;
    this.handler = () => this.size + 1;
  }
}
function sumWeights(xs: Leaf[]): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) total += xs[i].weight;
  return total;
}
function weights(xs: Leaf[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) out.push(xs[i].weight);
  return out;
}
function weightsCounted(xs: Leaf[]): number {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) out.push(xs[i].weight);
  return out.length;
}
function weightsByIndex(xs: Leaf[], out: number[]): number {
  for (let i = 0; i < xs.length; i++) out[i] = xs[i].weight;
  return out.length;
}
function callTwice(c: Crate): number {
  return c.handler() + c.handler();
}

function disturb(o: any, name: string, how: number): void {
  if (how === 1) delete o[name];
  else if (how === 2) Object.defineProperty(o, name, { get() { return 1; }, configurable: true });
  else if (how === 3) o[name] = how;
  else if (how === 4) Object.setPrototypeOf(o, null);
  else if (how === 5) Object.freeze(o);
}

const names = ["zz", "a", "weight", "size", "handler"];
const pool: any[] = [];
const leaves: Leaf[] = [];
for (let i = 0; i < 64; i++) {
  const leaf = new Leaf(i);
  leaves.push(leaf);
  pool.push(leaf, new Crate(i), make(i, i + 1));
}
const spare: any = { zz: 1, a: 2, weight: 3, size: 4, handler: 5 };
pool.push(spare);
for (let how = 1; how <= 5; how++) disturb(pool[pool.length - 1], names[how - 1], how);

const withAnotherName: any = make(1, 2);
withAnotherName[names[0]] = 7;
const withText: any = make(3, 4);
withText[names[1]] = "text";

const target: number[] = [];
let total = 0;
for (let round = 0; round < 3000; round++) {
  const at = (round & 63) * 3;
  total += sumWeights(leaves) + weights(leaves).length + weightsCounted(leaves) + weightsByIndex(leaves, target);
  total += callTwice(pool[at + 1]);
  total += (copyAndRead(pool[at + 2]) as number) + (copyAndAskForAnotherName(pool[at + 2]) === undefined ? 1 : 0) + (copyAndHas(pool[at + 2]) ? 1 : 0) + copyAndKeys(pool[at + 2]).length;
}
console.log(total);
console.log(copyAndAskForAnotherName(withAnotherName), copyAndHas(withAnotherName), copyAndKeys(withAnotherName), copyAndRead(withAnotherName));
console.log(copyAndAskForAnotherName(withText), copyAndHas(withText), copyAndKeys(withText), copyAndRead(withText));
