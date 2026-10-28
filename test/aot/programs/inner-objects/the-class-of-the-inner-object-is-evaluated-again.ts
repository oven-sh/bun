// The class of the inner object is evaluated again and again: each evaluation has a prototype of its own, and the objects of an earlier one keep theirs.
interface Holder<T> { c: T; n: number }
function build(tag: number, count: number) {
  class Inner {
    d: number;
    constructor(d: number) { this.d = d; }
    tagOf(): number { return tag; }
  }
  const out: Holder<Inner>[] = [];
  for (let i = 0; i < count; i++) out.push({ c: new Inner(i), n: i });
  return out;
}
const rounds: ReturnType<typeof build>[] = [];
for (let tag = 0; tag < 12; tag++) {
  rounds.push(build(tag, 300));
  if (tag % 4 === 3) Bun.gc(true);
}
let bad = "";
let sum = 0;
for (let tag = 0; tag < rounds.length && !bad; tag++) {
  const list = rounds[tag];
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (h.c.tagOf() !== tag || h.c.d !== i || h.n !== i) { bad = "WRONG at " + tag + ", " + i + ": " + h.c.tagOf() + " " + h.c.d; break; }
    sum += h.c.d + h.c.tagOf();
  }
}
const first = Object.getPrototypeOf(rounds[0][0].c), second = Object.getPrototypeOf(rounds[1][0].c);
console.log(sum, bad, first === second, first === Object.getPrototypeOf(rounds[0][299].c), rounds[3][7].c.constructor === rounds[3][8].c.constructor, rounds[3][7].c instanceof (rounds[4][0].c.constructor as any));
