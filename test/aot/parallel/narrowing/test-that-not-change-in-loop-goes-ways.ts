// for (const item of items) if (exclude === undefined || !(item.flags & exclude)) ..: the test of `exclude` comes out the same in every round of a call, and both ways occur among the calls.
// Neither way may cost the loop its types; here only the answers are compared, also where the value, the array or an element is not what its type says.
interface Item { flags: number; weight: number }
function sum(items: readonly Item[], exclude?: number): number { let total = 0; for (const item of items) { if (exclude === undefined || !(item.flags & exclude)) total |= item.weight; } return total; }
function pick(items: readonly Item[], mode: string | number): number { let total = 0; for (let i = 0; i < items.length; i++) { total += typeof mode === "string" ? items[i].flags : items[i].weight + mode; } return total; }
function scale(items: readonly Item[], by: number | null): number { let total = 0; for (const item of items) total += by === null ? item.weight : item.weight * by; return total; }
function count(items: readonly Item[], list: number[] | undefined): number { let total = 0; for (let i = 0; i < items.length; i++) { if (list) total += list.length + items[i].flags; else total -= items[i].weight; } return total; }
function changed(items: readonly Item[], box: { limit?: number }): number { let total = 0; for (const item of items) { if (box.limit === undefined) { total += item.weight; if (item.flags === 5) box.limit = 3; } else total -= item.flags & box.limit; } return total; }
const launder = new Function("v", process.env.LAUNDER_TEXT ?? "return v") as <V>(v: V) => V;
const items: Item[] = []; for (let i = 0; i < 50; i++) items.push({ flags: i & 7, weight: i * 3 });
const table = launder({ sum, pick, scale, count, changed });
const attempt = (label: string, run: () => unknown) => { try { console.log(label, String(run())); } catch (error) { console.log(label, (error as Error).constructor.name); } };
for (let round = 0; round < 3; round++) {
  attempt("sum without", () => table.sum(items));
  attempt("sum with", () => table.sum(items, 4));
  attempt("sum with zero", () => table.sum(items, 0));
  attempt("sum with a fraction", () => table.sum(items, 4.5));
  attempt("sum with null", () => table.sum(items, launder(null) as unknown as number));
  attempt("sum with text", () => table.sum(items, launder("4") as unknown as number));
  attempt("pick text", () => table.pick(items, "flags"));
  attempt("pick number", () => table.pick(items, 2));
  attempt("pick an object", () => table.pick(items, launder({ valueOf() { return 1; } }) as unknown as number));
  attempt("scale null", () => table.scale(items, null));
  attempt("scale by", () => table.scale(items, 3));
  attempt("scale by undefined", () => table.scale(items, launder(undefined) as unknown as number));
  attempt("count with", () => table.count(items, [1, 2, 3]));
  attempt("count without", () => table.count(items, undefined));
  attempt("count with null", () => table.count(items, launder(null) as unknown as undefined));
  attempt("changed in the loop", () => table.changed(items, {}));
  attempt("changed before", () => table.changed(items, { limit: 6 }));
  attempt("no items", () => table.sum([], 4) + table.pick([], 1) + table.scale([], null));
  attempt("holes", () => table.sum(launder([items[1], , items[3]]) as Item[], 4));
  attempt("other objects", () => table.sum(launder([{ weight: 2, flags: 1 }, { flags: "4", weight: 8 }, { weight: 16 }]) as Item[], 4));
  attempt("not an array", () => table.sum(launder(new Set(items)) as unknown as Item[], 4));
  attempt("not iterable", () => table.sum(launder({ length: 1 }) as unknown as Item[]));
}
