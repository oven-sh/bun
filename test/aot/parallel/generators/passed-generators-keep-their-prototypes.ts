// A prototype that is laid, or taken away, between the making of a generator and the function that takes it: the generator has the one that its function had when it was made.
function* g(list: number[], flag: boolean): any { for (const x of list) { if (x % 2) yield x; else if (flag) yield -x; } }
function* h(list: number[]): any { let i = 0; while (i < list.length) { yield list[i]; i++; } }
const table: any = { g, h }; (globalThis as any).table = table;
const plain: any = { g: g.prototype, h: h.prototype };
const own: any = { g: Object.create(g.prototype, { [Symbol.iterator]: { value: () => [40, 2][Symbol.iterator](), configurable: true } }), h: Object.create(h.prototype, { [Symbol.iterator]: { value: () => [50, 3][Symbol.iterator](), configurable: true } }) };
function sum(a: any, b?: any) { let s = 0; for (const v of a) s += v; return s; }
function first(a: any, b?: any) { for (const v of a) return v; return -1; }
function lay(name: string, p: any) { table[name].prototype = p; return 1; }
function change(name: string, to: any) { return lay(name, to[name]); }
const object = { *items(this: any, list: number[]): any { for (const x of list) yield x + 1; } };
table.items = object.items; plain.items = object.items.prototype; own.items = Object.create(plain.items, { [Symbol.iterator]: { value: () => [60, 4][Symbol.iterator]() } });
function outOfG(list: number[]) { return sum(g(list, true), change('g', own)); }
function backToG(list: number[]) { return sum(g(list, true), change('g', plain)); }
function outOfH(list: number[]) { return first(h(list), change('h', own)); }
function backToH(list: number[]) { return first(h(list), change('h', plain)); }
function outOfItems(list: number[]) { return sum(object.items(list), change('items', own)); }
function backToItems(list: number[]) { return sum(object.items(list), change('items', plain)); }
function heldOut(list: number[]) { const it = g(list, false); change('g', own); return sum(it); }
function heldBack(list: number[]) { const it = g(list, false); change('g', plain); return sum(it); }
for (let k = 0; k < 3; k++) {
  for (const list of [[], [1, 2, 3], [5]] as number[][]) {
    console.log(outOfG(list), backToG(list), sum(g(list, true)));
    console.log(outOfH(list), backToH(list), first(h(list)));
    console.log(outOfItems(list), backToItems(list), sum(object.items(list)));
    console.log(heldOut(list), heldBack(list), sum(g(list, false)));
  }
}
