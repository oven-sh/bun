// Which number fields get an int32 slot. Every field below only ever holds small integers.
// 4: what the operation that fills a field says.
class ByAnd { head = 0; next() { this.head = (this.head + 1) & 7; return this.head; } }
class ByMod { head = 0; size = 8; next() { this.head = (this.head + 1) % this.size; return this.head; } }
class ByModOr { head = 0; size = 8; next() { this.head = ((this.head + 1) % this.size) | 0; return this.head; } }
class ByMul { child = 0; down(i: number) { this.child = i * 2 + 1; return this.child; } }
class ByShift { child = 0; down(i: number) { this.child = (i << 1) + 1; return this.child; } }
class ByNegate { delta = 1; flip() { this.delta = -this.delta; return this.delta; } }
class ByCode { code = 0; read(text: string, i: number) { this.code = text.charCodeAt(i); return this.code; } }
class ByIndexOf { at = 0; find(text: string, part: string) { this.at = text.indexOf(part); return this.at; } }
class ByFloor { half = 0; halve(n: number) { this.half = Math.floor(n / 2); return this.half; } }
class ByMin { least = 0; take(a: number, b: number) { this.least = Math.min(a, b); return this.least; } }
class ByLength { chars = 0; items = 0; count(text: string, list: number[]) { this.chars = text.length; this.items = list.length; return this.chars + this.items; } }

// 3: a store under the same name into what can have no such field.
type OnFunction = { mark: number; other: number };
type OnArray = { spot: number; other: number };
type OnError = { place: number; other: number };
function tagged() { return 1; }
tagged.mark = 1.5;
const listWithName: number[] & { spot?: number } = [1, 2, 3];
listWithName.spot = 1.5;
const failure: Error & { place?: number } = new Error("x");
failure.place = 1.5;

const section = process.argv[2] ?? "all";
const rounds = section === "all" ? 10 : 20_000_000;
function run(name: string, body: (i: number) => number) {
  if (section !== "all" && section !== name) return;
  let total = 0;
  for (let i = 0; i < rounds; i++) total += body(i & 1023);
  console.log(name, total);
}

const byAnd = new ByAnd(), byMod = new ByMod(), byModOr = new ByModOr(), byMul = new ByMul(), byShift = new ByShift(), byNegate = new ByNegate();
const byCode = new ByCode(), byIndexOf = new ByIndexOf(), byFloor = new ByFloor(), byMin = new ByMin(), byLength = new ByLength();
const text = "the quick brown fox jumps over the lazy dog".repeat(30);
const numbers = [1, 2, 3, 4];
const kept: unknown[] = [byAnd, byMod, byModOr, byMul, byShift, byNegate, byCode, byIndexOf, byFloor, byMin, byLength];

const onFunction: OnFunction[] = [], onArray: OnArray[] = [], onError: OnError[] = [];
for (let i = 0; i < 1024; i++) {
  onFunction.push({ mark: i, other: i });
  onArray.push({ spot: i, other: i });
  onError.push({ place: i, other: i });
}

run("and", () => byAnd.next());
run("mod", () => byMod.next());
run("modOr", () => byModOr.next());
run("mul", i => byMul.down(i));
run("shift", i => byShift.down(i));
run("negate", () => byNegate.flip());
run("code", i => byCode.read(text, i));
run("indexOf", () => byIndexOf.find("abc", "c"));
run("floor", i => byFloor.halve(i));
run("min", i => byMin.take(i, 7));
run("length", () => byLength.count(text, numbers));
run("mark", i => onFunction[i].mark);
run("markOther", i => onFunction[i].other);
run("spot", i => onArray[i].spot);
run("place", i => onError[i].place);
console.log(kept.length, tagged.mark, listWithName.spot, failure.place);
