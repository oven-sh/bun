// Where a value that is an object, undefined or null has tested falsy it goes on as undefined or null: `a && f(a)`, `a || b`, `!a`, early returns, loops, and the same through parameters that untyped callers fill.
interface Item { name: string; next?: Item | null }
function nameOf(item: Item): string { return item.name; }
function andThen(item: Item | undefined | null): string | undefined | null { return item && nameOf(item); }
function orElse(item: Item | undefined, other: Item): Item { return item || other; }
function early(item: Item | null): string { if (!item) return String(item); return item.name; }
function keepsWhichNil(item: Item | undefined | null): string { const left = item && item.next; return left === undefined ? "undefined" : left === null ? "null" : left.name; }
function last(item: Item | undefined | null): string { let seen = "none"; while (item) { seen = item.name; item = item.next; } return seen + " " + String(item); }
function handOn(item: Item | undefined | null): string { return take(item && item.next); }
function take(item: Item | undefined | null): string { return item ? item.name : String(item); }
const c: Item = { name: "c", next: null }, b: Item = { name: "b", next: c }, a: Item = { name: "a", next: b }, alone: Item = { name: "alone" };
console.log(andThen(a), andThen(undefined), andThen(null), orElse(undefined, b).name, orElse(a, b).name, early(null), early(c));
console.log(keepsWhichNil(a), keepsWhichNil(c), keepsWhichNil(alone), keepsWhichNil(undefined), keepsWhichNil(null), last(a), last(alone), last(undefined), last(null));
console.log(handOn(a), handOn(c), handOn(alone), handOn(undefined), handOn(null));
const untyped: any[] = [andThen, early, keepsWhichNil, last, handOn];
for (const f of untyped) {
  for (const given of [a, undefined, null, 0, "", false, "text"]) {
    try { console.log(f.name, String(given && (given as any).name || given), String(f(given))); } catch (error) { console.log(f.name, String(given), (error as Error).name); }
  }
}
