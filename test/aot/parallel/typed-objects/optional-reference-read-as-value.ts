// An optional property that holds an object or a string is read and handed on as a value: returned, passed, stored, compared.
// It may be missing, undefined, null or there, and only `in` and the keys tell missing from undefined.
interface Inner { v: number }
interface Holder { id: number; inner?: Inner | null; text?: string | null; next?: Holder }

function innerOf(h: Holder): Inner | null | undefined { return h.inner; }
function textOf(h: Holder): string | null | undefined { return h.text; }
function nextOf(h: Holder): Holder | undefined { return h.next; }
function describe(value: unknown): string {
  return value === undefined ? "undefined" : value === null ? "null" : typeof value === "object" ? JSON.stringify(value) : String(value);
}
function pass(h: Holder): string { return describe(h.inner) + "|" + describe(h.text) + "|" + describe(h.next && h.next.id); }
function collect(h: Holder, into: unknown[]): void { into.push(h.inner, h.text, h.next); }
function copy(from: Holder, to: Holder): void { to.inner = from.inner; to.text = from.text; to.next = from.next; }
function same(a: Holder, b: Holder): string { return [a.inner === b.inner, a.text === b.text, a.next === b.next, a.inner == b.inner, a.text == b.text].join(); }
function orElse(h: Holder): string { return describe(h.inner ?? "no inner") + "|" + describe(h.text ?? "no text") + "|" + describe(h.text || "empty"); }

const shared: Inner = { v: 7 };
const holders: Holder[] = [
  { id: 0 },
  { id: 1, inner: undefined, text: undefined, next: undefined },
  { id: 2, inner: null, text: null },
  { id: 3, inner: shared, text: "three" },
  { id: 4, inner: { v: 4 }, text: "" },
];
holders[4].next = holders[3];
holders[3].next = holders[0];

const readers: Array<(h: Holder) => unknown> = [innerOf, textOf, nextOf, pass, orElse];
for (const h of holders) {
  console.log(h.id, readers.map(read => describe(read(h))).join(" ; "), "inner" in h, "text" in h, "next" in h, Object.keys(h).join());
  const all: unknown[] = [];
  collect(h, all);
  console.log(all.map(describe).join());
}
for (const a of holders) console.log(holders.map(b => same(a, b)).join(" "));
for (const from of holders) {
  const to: Holder = { id: 100 + from.id };
  copy(from, to);
  console.log(pass(to), Object.keys(to).join(), same(from, to));
}
let count = 0;
for (let round = 0; round < 2000; round++) {
  const h = holders[round % holders.length];
  if (innerOf(h)) count++;
  if (textOf(h) !== undefined) count += 2;
  if (nextOf(h) === undefined) count += 4;
}
console.log(count);
