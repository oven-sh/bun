// Takes members whose types are numeric enums or integer literals for an int32. Three other entry points, which nothing here imports, have objects with the same member names that hold strings and fractions.
// Entry points: ./strings.ts ./fractions.js ./untyped.ts
import type { int32 } from "bun";
enum Color { Red, Green, Blue }
const enum Side { Left = 1, Right = 2 }
enum Flags { None = 0, Read = 1, Write = 2 }
enum Only { One = 7 }
interface Holder { color: Color; next?: Color }
interface Leveled { level: 1 | 2 | 3 }
interface First { kind: 1; first: number }
interface Second { kind: 2; second: number }
class Pixel { color: Color = Color.Blue; }
class Kept { held: int32 = 0; }
function make(): Holder { return { color: Color.Blue }; }

function fromHolder(holder: { color: Color }): int32 { return holder.color; }
function fromConstEnum(holder: { side: Side }): int32 { return holder.side; }
function fromFlags(holder: { flags: Flags }): int32 { return holder.flags; }
function fromOnlyMember(holder: { only: Only }): int32 { return holder.only; }
function fromLiterals(holder: Leveled): int32 { return holder.level; }
function fromOneLiteral(holder: { one: 5 }): int32 { return holder.one; }
function fromNested(holder: { inner: { color: Color } }): int32 { return holder.inner.color; }
function fromInstance(pixel: Pixel): int32 { return pixel.color; }
function fromEither(value: Holder | Pixel): int32 { return value.color; }
function byKey(holder: Holder): int32 { return holder["color"]; }
function byCall(): int32 { return make().color; }
function byOptional(holder: Holder): int32 { return holder.next ?? holder.color; }
function byOptionalChain(holder: Holder | null): int32 { return holder?.color ?? -1; }
function byVariable(holder: Holder): int32 { const kept: int32 = holder.color; return kept; }
function byElement(list: Holder[]): int32 { return list[0].color; }
function byStore(holder: Holder): int32 { const kept = new Kept(); kept.held = holder.color; return kept.held; }
function byArgument(holder: Holder): int32 { return double(holder.color); }
function double(value: int32): int32 { return (value * 2) | 0; }
function byPattern({ color }: Holder): int32 { return color; }
function byLoop(list: Leveled[]): int32 { let last: int32 = 0; for (const each of list) last = each.level; return last; }
function byChoice(first: boolean, holder: Holder, other: Holder): int32 { return first ? holder.color : other.color; }
function byKind(node: First | Second): int32 { return node.kind; }
function throughVariable(holder: Holder): int32 { const color = holder.color; return color; }
function throughLiteral(holder: Holder): int32 { const copy = { copied: holder.color }; return copy.copied; }
function inferred(holder: Holder) { return holder.color; }
function throughCall(holder: Holder): int32 { return inferred(holder); }
function sum(holder: Leveled): int32 { return holder.level + 1; }
function product(holder: Leveled): int32 { return holder.level * 2; }
function negated(holder: Leveled): int32 { return -holder.level; }
function least(holder: Leveled): int32 { return Math.min(holder.level, 2); }

const holder: Holder = { color: Color.Green };
console.log(
  fromHolder({ color: Color.Green }), fromConstEnum({ side: Side.Right }), fromFlags({ flags: Flags.Read | Flags.Write }), fromOnlyMember({ only: Only.One }), fromLiterals({ level: 3 }), fromOneLiteral({ one: 5 }),
  fromNested({ inner: { color: Color.Blue } }), fromInstance(new Pixel()), fromEither(holder), fromEither(new Pixel()), byKey(holder), byCall(), byOptional(holder), byOptional({ color: Color.Red, next: Color.Blue }),
  byOptionalChain(null), byOptionalChain(holder), byVariable(holder), byElement([holder]), byStore(holder), byArgument(holder), byPattern(holder), byLoop([{ level: 1 }, { level: 2 }]),
  byChoice(true, holder, make()), byChoice(false, holder, make()), byKind({ kind: 1, first: 0.5 }), byKind({ kind: 2, second: 0.5 }), throughVariable(holder), throughLiteral(holder), throughCall(holder),
  sum({ level: 3 }), product({ level: 3 }), negated({ level: 3 }), least({ level: 3 }),
);

for (const text of ['{"color":1}', '{"color":"none"}', '{"color":1.5}', '{"color":null}', "{}", '{"color":4294967296}', '{"color":-0}', '{"color":[2]}']) {
  const given: Holder = JSON.parse(text);
  console.log(text, fromHolder(given), Object.is(byKey(given), -0), byVariable(given), byElement([given]), byStore(given), byPattern(given), byChoice(true, given, holder), throughVariable(given), throughLiteral(given), throughCall(given));
}
for (const text of ['{"level":2}', '{"level":"high"}', '{"level":2.5}', '{"level":null}', "{}", '{"level":2147483647}', '{"level":0}']) {
  const given: Leveled = JSON.parse(text);
  console.log(text, fromLiterals(given), sum(given), product(given), Object.is(negated(given), -0), negated(given), least(given));
}
const wide: number = Number("2.5");
const fraction: Color = wide;
console.log(fromHolder({ color: fraction }), byVariable({ color: fraction }));
