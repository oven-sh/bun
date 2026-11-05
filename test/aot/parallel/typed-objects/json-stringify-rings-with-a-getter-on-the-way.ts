// Records that hold themselves, directly, by way of others, of a list or of toJSON, with a getter on the way: JSON.stringify throws, and the getter has run as often as it runs in plain Bun.
const log: string[] = [];
function show(label: string, run: () => string | undefined): void {
  for (let turn = 0; turn < 3; turn++) {
    let text: string | undefined;
    try { for (let i = 0; i < 20; i++) { log.length = 0; text = run(); } } catch (error) { text = "throws " + (error as Error).name; }
    console.log(label + ": " + text + " | " + log.join());
  }
}
const counted = (name: string) => ({ get g() { log.push(name); return 1; } });
interface One { id: number; before?: unknown; self?: One | null; after?: unknown; note?: string }
function one(order: number): One {
  const made: One = { id: order };
  if (order & 1) made.note = "n";
  made.before = counted("one");
  if (order & 2) made.after = { deep: { deeper: made } };
  made.self = order & 4 ? made : null;
  if (!(order & 1)) made.note = "late";
  return made;
}
for (let order = 0; order < 8; order++) show("one record " + order, () => JSON.stringify(one(order)));
for (let order = 2; order < 8; order += 2) show("three times in a list " + order, () => { const ring = one(order); return JSON.stringify([ring, ring, ring]); });
interface Left { name: string; seen?: unknown; right?: Right }
interface Right { size: number; left?: Left; seen?: unknown }
function two(first: boolean): Left { const left: Left = { name: "l" }; const right: Right = { size: 1 }; if (first) left.seen = counted("left"); left.right = right; right.seen = counted("right"); right.left = left; if (!first) left.seen = counted("left"); return left; }
show("two records, the getter first", () => JSON.stringify(two(true)));
show("two records, the getter last", () => JSON.stringify(two(false)));
interface A { a: number; b?: B; seen?: unknown } interface B { b: number; c?: C } interface C { c: number; seen?: unknown; a?: A }
function three(): A { const a: A = { a: 1 }; const b: B = { b: 2 }; const c: C = { c: 3 }; a.seen = counted("a"); a.b = b; b.c = c; c.seen = counted("c"); c.a = a; return a; }
show("three records", () => JSON.stringify(three()));
interface Listed { id: number; seen?: unknown; rows?: Listed[] }
function listed(): Listed { const top: Listed = { id: 0 }; const row: Listed = { id: 1 }; top.seen = counted("top"); row.seen = counted("row"); row.rows = [top]; top.rows = [row, row]; return top; }
show("through a list", () => JSON.stringify(listed()));
class Told { constructor(public held: unknown) {} toJSON() { log.push("toJSON"); return this.held; } }
interface Teller { id: number; seen?: unknown; told?: Told }
function teller(): Teller { const made: Teller = { id: 1 }; made.seen = counted("teller"); made.told = new Told(made); return made; }
show("through toJSON", () => JSON.stringify(teller()));
interface Plain { id: number; next?: Plain; label?: string }
function plainRing(length: number): Plain { const first: Plain = { id: 0 }; let last = first; for (let i = 1; i < length; i++) { const made: Plain = { id: i }; made.label = "p" + i; last.next = made; last = made; } last.next = first; return first; }
for (const length of [1, 2, 3]) show("no code in the ring " + length, () => JSON.stringify({ seen: counted("outside"), ring: plainRing(length) }));
function twice(): unknown { const shared: One = { id: 9 }; shared.before = counted("shared"); shared.note = "no ring"; return [shared, { again: shared }, shared]; }
show("the same record three times without a ring", () => JSON.stringify(twice()));
