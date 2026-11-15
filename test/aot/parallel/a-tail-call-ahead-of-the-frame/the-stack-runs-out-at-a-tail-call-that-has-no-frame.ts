class Item { kind: number; size: number; cached: number; constructor(kind: number, size: number) { this.kind = kind; this.size = size; this.cached = 0; } }
function heavy(size: number): number { return size <= 0 ? 0 : size + heavy(size - 1); }
function small(item: Item): number { const first = heavy(item.size); const second = heavy(item.kind); return first + second + item.size + 1 - first - second; }
function other(item: Item): number { const first = heavy(item.kind); const second = heavy(item.size); return first + second + item.size + 2 - first - second; }
function cachedOf(item: Item): number { if (item.cached) return item.cached; const made = heavy(item.size) + 1; item.cached = made; item.kind |= 8; return made; }
function route(item: Item): number {
  if (item.kind & 1) return small(item);
  if (item.kind & 2) return other(item);
  const first = cachedOf(item);
  const second = item.size > 1 ? route(new Item(item.kind & 7, item.size - 1)) : heavy(item.size);
  return first + second + item.kind;
}
function twice(item: Item): number { const first = route(item); const second = route(item); if (first !== second) throw new Error("two answers"); item.cached = 0; item.size = item.size | 0; return first + second - first; }
let answers = 0;
let overflows = 0;
function down(item: Item, depth: number): number {
  let here = item.size + 1;
  try { here = twice(item); answers++; } catch (error) { if (!(error instanceof RangeError)) throw error; overflows++; }
  if (here !== item.size + 1) throw new Error("a wrong answer at depth " + depth);
  return down(item, depth + 1) + 0;
}
function padded(item: Item, pads: number): number { return pads > 0 ? padded(item, pads - 1) + 0 : attempt(item); }
function attempt(item: Item): number { try { return down(item, 0); } catch (error) { if (!(error instanceof RangeError)) throw error; return -1; } }
let attempts = 0;
for (let pads = 0; pads < 48; pads++) { padded(new Item(1, 7), pads); attempts++; }
console.log(attempts, answers > 0, overflows > 0, route(new Item(1, 1)), route(new Item(2, 1)), route(new Item(4, 3)));
