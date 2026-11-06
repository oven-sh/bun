// `value as Leaf` with `value: Leaf | Opaque` picks the Leaf, so the type Leaf stands for a Leaf alone. A value that is declared Opaque and is something else, or is a Root,
// still goes through the cast as it does in plain Bun: reads and stores find what the object has.
interface Opaque { readonly mark?: never }
class Leaf { size: number; constructor(size: number) { this.size = size; } }
class Root { name = "root"; size = "wide"; }
const hidden = (value: unknown): any => value;
function sizeOf(value: Leaf | Opaque | null): unknown { return (value as Leaf).size; }
function rename(value: Root | Opaque): unknown { (value as Root).name = "renamed"; return (value as Root).name; }
function both(value: Leaf | Root | Opaque): unknown { return String((value as Leaf).size) + " " + String((value as Root).name); }
const attempt = (f: () => unknown): unknown => { try { return f(); } catch (error) { return (error as Error).name; } };
const host: Opaque = hidden({ other: 1 });
const rootAsOpaque: Opaque = hidden(new Root());
const frozen: Opaque = hidden(Object.freeze({ name: "fixed" }));
for (let round = 0; round < 4; round++) {
  console.log(sizeOf(new Leaf(round)), sizeOf(host), sizeOf(rootAsOpaque), sizeOf(hidden("text")), sizeOf(hidden(round)));
  console.log(rename(new Root()), rename(host), rename(hidden(new Leaf(7))), attempt(() => rename(frozen)), JSON.stringify(host));
  console.log(both(new Leaf(round)), "|", both(new Root()), "|", both(host), "|", both(hidden([1, 2])));
}
console.log(attempt(() => sizeOf(null)), attempt(() => rename(hidden(undefined))));
