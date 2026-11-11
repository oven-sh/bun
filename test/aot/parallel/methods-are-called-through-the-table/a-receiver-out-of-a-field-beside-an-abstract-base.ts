// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a test that is held against the proven shapes alone shows nothing: the walk stopped at "a receiver of the method table is not shown to be what its type says"
// STATISTIC: MethodCallsThroughTable >= 6
// A receiver that is read out of a field is of the classes that the field holds: proven, and shown by no test. One class of the row has no method of the name: the base is
// abstract. So the shape is asked in front of the table call anyway; it is asked in full, of every shape, and so that test shows the receiver. What fails it goes by name: an object of the base itself, made by code
// that the checker does not see through, throws as in plain Bun.
abstract class Part { abstract weigh(scale: Scale): number }
class Leaf extends Part { constructor(readonly grams: number) { super(); } weigh(scale: Scale): number { return scale.leaf(this); } }
class Pair extends Part { constructor(readonly first: Part, readonly second: Part) { super(); } weigh(scale: Scale): number { return scale.pair(this); } }
class Wrapped extends Part { constructor(readonly inner: Part) { super(); } weigh(scale: Scale): number { return scale.wrapped(this); } }
class Scale {
  leaf(part: Leaf): number { return part.grams; }
  pair(part: Pair): number { return part.first.weigh(this) + part.second.weigh(this); }
  wrapped(part: Wrapped): number { return part.inner.weigh(this) + 1; }
}
function build(depth: number, seed: number): Part {
  if (depth === 0) return new Leaf(seed & 7);
  return seed % 3 === 0 ? new Wrapped(build(depth - 1, seed + 1)) : new Pair(build(depth - 1, seed + 1), build(depth - 1, seed + 2));
}
const said: unknown[] = [];
const scale = new Scale();
let sum = 0;
for (let i = 0; i < 300; i++) sum += build(4, i).weigh(scale);
said.push(sum);
const bare = new (Part as any)() as Part;
for (const broken of [new Pair(new Leaf(1), bare), new Pair(bare, new Leaf(2)), new Wrapped(bare)]) {
  try { said.push(broken.weigh(scale)); } catch (error) { said.push((error as Error).name); }
}
const late = new Pair(new Leaf(3), new Leaf(4));
(late as any).second = { weigh() { return 40; } };
said.push(late.weigh(scale));
(late as any).first = undefined;
try { said.push(late.weigh(scale)); } catch (error) { said.push((error as Error).name); }
console.log(said.map(String).join(" "));
