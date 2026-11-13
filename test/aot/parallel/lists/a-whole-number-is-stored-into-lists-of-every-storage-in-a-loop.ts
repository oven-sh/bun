function fill(list: unknown[]): void {
  for (let i = 0; i < list.length; i++) list[i] = 7;
}
function zero(list: unknown[], upTo: number): void {
  for (let i = 0; i < upTo; i++) list[i] = 0;
}
function literalOfInt32s(): unknown[] {
  return [1, 2, 3];
}
function literalOfTexts(): unknown[] {
  return ["a", "b", "c"];
}
function literalOfFractions(): unknown[] {
  return [0.5, 1.5, 2.5];
}
function show(name: string, list: unknown): void {
  console.log(name, JSON.stringify(list));
}
const made: Record<string, () => unknown[]> = {
  int32s: () => [1, 2, 3].map(x => x + 1),
  texts: () => ["a", "b", "c"].map(x => x + "!"),
  objects: () => [{ a: 1 }, { a: 2 }, null],
  fractions: () => [0.5, 1.5, 2.5].map(x => x * 2 + 0.25),
  mixed: () => [1, "two", 3.5, null, undefined],
  empty: () => [],
  holes: () => { const l: unknown[] = [1, 2, 3, 4]; delete l[1]; return l; },
  holesOfTexts: () => { const l: unknown[] = ["a", "b", "c"]; delete l[2]; return l; },
  byLength: () => new Array(4),
  sparse: () => { const l: unknown[] = []; l[2000] = 1; l.length = 5; return l; },
};
for (let round = 0; round < 3; round++) {
  for (const name of Object.keys(made)) {
    const list = made[name]!();
    fill(list);
    show(name, list);
  }
}
for (let round = 0; round < 3; round++) {
  const a = literalOfInt32s(), b = literalOfTexts(), c = literalOfFractions();
  fill(a); fill(b); fill(c);
  show("written", [a, b, c]);
  show("made anew", [literalOfInt32s(), literalOfTexts(), literalOfFractions()]);
}
for (const make of [literalOfInt32s, literalOfTexts, made.objects!]) {
  const frozen = Object.freeze(make());
  let said = "stored";
  try { fill(frozen as unknown[]); } catch (error) { said = (error as Error).constructor.name; }
  show(said, frozen);
  const sealed = Object.seal(make());
  fill(sealed);
  show("sealed", sealed);
}
{
  const past = ["x", "y"] as unknown[];
  zero(past, 5);
  show("past the end", past);
  const ints = [9, 9].map(x => x) as unknown[];
  zero(ints, 4);
  show("past the end of int32s", ints);
}
{
  const seen: unknown[] = [];
  const watched = ["p", "q", "r"].map(x => x) as unknown[];
  Object.defineProperty(watched, 1, { set(v) { seen.push(v); }, get() { return "got"; }, configurable: true });
  fill(watched);
  show("an accessor under an index", [watched, seen]);
}
{
  class Below extends Array<unknown> {}
  const below = Below.from(["m", "n"]);
  fill(below);
  show("a class below Array", [below, below instanceof Below]);
}
{
  const like = { length: 3, 0: "a" } as unknown as unknown[];
  fill(like);
  show("no list at all", like);
}
