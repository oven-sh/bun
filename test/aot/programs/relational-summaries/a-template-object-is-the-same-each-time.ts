// The array of strings that a tagged template hands to its tag is made once for the place in the program: every evaluation hands over the same frozen object. It looks like a literal and is no fresh object: libraries key their caches by it.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const strings = (s: TemplateStringsArray, ..._: unknown[]): TemplateStringsArray => s;
const here = (n: number): TemplateStringsArray => strings`a${n}b`;
const there = (n: number): TemplateStringsArray => strings`a${n}b`;
function twice(n: number): boolean {
  return here(n) === here(n + 1);
}
function twoPlaces(n: number): boolean {
  return here(n) === there(n);
}
function inALoop(): number {
  const seen = new Set<TemplateStringsArray>();
  for (let i = 0; i < 50; i++) seen.add(strings`x${i}y`);
  return seen.size;
}
function madeByEachClosure(): number {
  const seen = new Set<TemplateStringsArray>();
  for (let i = 0; i < 5; i++) seen.add((() => strings`p${i}q`)());
  return seen.size;
}
let same = 0;
let different = 0;
for (let i = 0; i < 400; i++) {
  if (twice(i)) same++;
  if (!twoPlaces(i)) different++;
}
console.log(same, different, inALoop(), madeByEachClosure());

// A cache keyed by the object, as template libraries have it. The first evaluation fills it; when its maker is long gone the entry is found again.
interface Compiled {
  parts: number;
  uses: number;
}
const compiled = new WeakMap<TemplateStringsArray, Compiled>();
function html(s: TemplateStringsArray, ...values: unknown[]): Compiled {
  let entry = compiled.get(s);
  if (!entry) compiled.set(s, (entry = { parts: s.length, uses: 0 }));
  entry.uses += values.length;
  return entry;
}
const render = (name: string, n: number): Compiled => html`<p>${name}</p><b>${n}</b>`;
let last: Compiled | undefined;
for (let i = 0; i < 300; i++) {
  last = render("n" + i, i);
  if (i % 100 === 99) churn(40);
}
console.log(last!.parts, last!.uses, churn(60), render("again", 0).uses);

// It is frozen, its `raw` is frozen, and both are the same each time.
const first = here(1);
console.log(Object.isFrozen(first), Object.isFrozen(first.raw), first.raw === here(2).raw, first.length, first.raw.join("|"));
function tryToWrite(s: TemplateStringsArray): string {
  try {
    (s as unknown as string[])[0] = "changed";
    return "written";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
console.log(tryToWrite(here(3)), here(4)[0]);
