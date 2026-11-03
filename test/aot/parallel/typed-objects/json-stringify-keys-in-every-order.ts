// Records whose keys came in every order are written as JSON.
interface Row { id: number; title?: string; price?: number; note?: string | null; flag?: boolean }
interface Holder { name: string; row?: Row; rows?: Row[]; held?: unknown; when?: Date }
interface Wide { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number; k?: number; l?: number; m?: string; n?: string; o?: string; p?: string }
class Point { x: number; y?: number; label?: string; constructor(x: number) { this.x = x; } }
class Told { constructor(public run: () => void) {} toJSON() { this.run(); return "told"; } }
function show(label: string, run: () => string | undefined): void {
  let text: string | undefined = "";
  try { for (let i = 0; i < 40; i++) text = run(); } catch (error) { text = "throws " + (error as Error).name; }
  console.log(label + ": " + text);
}
const writeRow = (row: Row) => JSON.stringify(row);
const writeRows = (rows: Row[]) => JSON.stringify(rows);
const writeHolder = (holder: Holder) => JSON.stringify(holder);
const writeWide = (wide: Wide) => JSON.stringify(wide);
const writePoint = (point: Point) => JSON.stringify(point);
const names = ["title", "price", "note", "flag"] as const;
function fill(row: Row, name: (typeof names)[number], n: number): void {
  if (name === "title") row.title = "t" + n;
  else if (name === "price") row.price = n + 0.5;
  else if (name === "note") row.note = n & 1 ? null : "n" + n;
  else row.flag = (n & 1) === 0;
}
function permutations(count: number): number[][] {
  if (!count) return [[]];
  const all: number[][] = [];
  for (const rest of permutations(count - 1)) for (let at = 0; at <= rest.length; at++) all.push([...rest.slice(0, at), count - 1, ...rest.slice(at)]);
  return all;
}
const everyOrder: Row[] = [];
for (const order of permutations(4)) for (let length = 0; length <= 4; length++) { const row: Row = { id: everyOrder.length }; for (const at of order.slice(0, length)) fill(row, names[at], everyOrder.length); everyOrder.push(row); }
show("every order", () => writeRows(everyOrder));
for (const at of [0, 7, 33, 64, 119]) show("alone " + at, () => writeRow(everyOrder[at]));

const deleted: Row = { id: 1, title: "one", price: 2 }; delete deleted.title; deleted.title = "again";
show("deleted and added again", () => writeRow(deleted));
const onlyDeleted: Row = { id: 1, title: "one", price: 2 }; delete onlyDeleted.price; delete (onlyDeleted as any).id;
show("two deleted", () => writeRow(onlyDeleted));
const odd: Row = { id: -0 }; odd.price = NaN; odd.title = undefined; odd.note = null; odd.flag = false;
show("odd values", () => writeRow(odd));
const infinite: Row = { id: Infinity }; odd.price = -Infinity;
show("infinite", () => writeRow(infinite));
const escaped: Row = { id: 1 }; escaped.note = "a\"b\\c\n \ud800"; escaped.title = "中文";
show("texts with escapes", () => writeRow(escaped));

const frozen: Row = { id: 1 }; frozen.price = 2; frozen.title = "f"; Object.freeze(frozen);
show("frozen", () => writeRow(frozen));
const sealed: Row = { id: 1 }; sealed.note = "s"; sealed.title = "f"; Object.seal(sealed);
show("sealed", () => writeRow(sealed));
const closed: Row = { id: 1 }; closed.flag = true; closed.price = 1; Object.preventExtensions(closed);
show("not extensible", () => writeRow(closed));
const withGetter: Row = { id: 1 }; withGetter.price = 2; Object.defineProperty(withGetter, "title", { get() { return "got"; }, enumerable: true, configurable: true }); withGetter.note = "n";
show("a getter", () => writeRow(withGetter));
const hidden: Row = { id: 1 }; hidden.price = 2; hidden.title = "h"; Object.defineProperty(hidden, "price", { enumerable: false });
show("not enumerable", () => writeRow(hidden));
const readOnly: Row = { id: 1 }; readOnly.price = 2; readOnly.title = "h"; Object.defineProperty(readOnly, "price", { writable: false });
show("read-only", () => writeRow(readOnly));
const withSymbol: Row = { id: 1 }; (withSymbol as any)[Symbol("s")] = 1; withSymbol.title = "t";
show("a symbol key", () => writeRow(withSymbol));
const key = ["ex", "tra"].join("");
const withExtra: Row = { id: 1 }; withExtra.price = 1; (withExtra as any)[key] = [1, 2]; withExtra.title = "t";
show("an extra key between", () => writeRow(withExtra));
const withIndex: Row = { id: 1 }; withIndex.title = "t"; (withIndex as any)[2] = "two"; (withIndex as any)["1"] = "one"; withIndex.price = 3;
show("index keys", () => writeRow(withIndex));
const otherType: Row = { id: 1 }; otherType.title = "t"; (otherType as any).price = "a text"; (otherType as any).id = { deep: [1] };
show("values of other types", () => writeRow(otherType));

function holder(n: number): Holder {
  const made: Holder = { name: "h" + n };
  if (n & 1) made.rows = [everyOrder[n], everyOrder[n + 40]];
  if (n & 2) made.held = n & 4 ? { plain: n } : [n, "x", null];
  made.row = everyOrder[n * 3];
  if (n & 8) made.when = new Date(86400000 * n);
  return made;
}
for (let n = 0; n < 16; n++) show("holder " + n, () => writeHolder(holder(n)));
const changing: Holder = { name: "c" };
changing.held = new Told(() => { delete changing.row; (changing as any).late = 1; changing.rows = [{ id: 9 }]; });
changing.row = { id: 1 }; changing.rows = [];
show("changed while it is written", () => { changing.row = { id: 1 }; delete (changing as any).late; delete changing.rows; changing.rows = []; return writeHolder(changing); });
const swapping: Holder = { name: "s" };
swapping.held = new Told(() => { const row = swapping.row; delete swapping.row; delete swapping.when; swapping.when = new Date(0); swapping.row = row; });
swapping.row = { id: 2 }; swapping.when = new Date(1000);
show("two keys swapped while it is written", () => writeHolder(swapping));
const sameOrder: Holder = { name: "v" };
sameOrder.held = new Told(() => { sameOrder.row = { id: 77, note: "new" }; });
sameOrder.row = { id: 3 };
show("a value replaced while it is written", () => { sameOrder.row = { id: 3 }; return writeHolder(sameOrder); });
const ring: Holder = { name: "r" }; ring.rows = []; ring.held = ring;
show("holds itself", () => writeHolder(ring));
const proxied: Holder = { name: "p" }; proxied.held = new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["b", "a"], get: (target, name) => (name === "toJSON" ? undefined : String(name)) }); proxied.row = { id: 4 };
show("a proxy within", () => writeHolder(proxied));
const big: Holder = { name: "b" }; big.row = { id: 5 }; big.held = 10n;
show("a bigint within", () => writeHolder(big));
const holes: Row[] = [everyOrder[5], everyOrder[6], everyOrder[7]]; delete (holes as any)[1];
show("a hole among them", () => writeRows(holes));

const letters = "abcdefghijklmnop";
function wide(seed: number): Wide {
  const made: Wide = {};
  let state = seed;
  for (let n = 0; n < 16; n++) { state = (state * 1103515245 + 12345) & 0x7fffffff; const letter = letters[(state >> 8) % 16]; if (letter < "m") (made as any)[letter] = n; else (made as any)[letter] = "s" + n; }
  return made;
}
for (let seed = 1; seed <= 12; seed++) show("wide " + seed, () => writeWide(wide(seed)));
show("no key", () => writeWide({}));
function point(n: number): Point { const made = new Point(n); if (n & 1) made.label = "p" + n; made.y = n * 2; if (!(n & 1)) made.label = "q" + n; return made; }
for (let n = 0; n < 4; n++) show("point " + n, () => writePoint(point(n)));
