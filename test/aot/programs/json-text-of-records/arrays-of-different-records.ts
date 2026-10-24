const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function text(value: unknown): string {
  return JSON.stringify(leak(value));
}
interface Item { id: number; title: string; price: number; inStock: boolean }
function item(id: number): Item {
  return { id, title: "Product " + id, price: 199 + id * 350, inStock: id % 7 > 0 };
}
function reordered(id: number): Item {
  return { title: "Product " + id, id, inStock: id % 7 > 0, price: 199 + id * 350 };
}
const plain = Array.from({ length: 9 }, (_, id) => item(id));
console.log(text(plain));
const orders = plain.map((row, index) => (index % 3 === 1 ? reordered(row.id) : row));
console.log(text(orders));
const strangers: unknown[] = [item(1), item(2), null, item(3), undefined, item(4), 5, item(5), "six", item(6), [item(7)], item(8), { id: 9 }, item(10), () => 1, item(11), , item(12)];
console.log(text(strangers));
const extended = plain.map((row) => ({ ...row }));
(extended[2] as any).extra = "added";
(extended[4] as any)[0] = "index";
delete (extended[5] as any).title;
(extended[6] as any).title = undefined;
(extended[7] as any).price = "a string";
(extended[8] as any).inStock = null;
console.log(text(extended));
const changed = Array.from({ length: 8 }, (_, id) => item(id));
Object.defineProperty(changed[1], "title", { get: () => "from a getter", enumerable: true, configurable: true });
Object.defineProperty(changed[2], "price", { value: 1, enumerable: false });
Object.freeze(changed[3]);
Object.seal(changed[4]);
Object.preventExtensions(changed[5]);
Object.setPrototypeOf(changed[6], { toJSON() { return "through the prototype"; } });
(changed[7] as any).toJSON = function () { return { only: this.id }; };
console.log(text(changed));
const seen: string[] = [];
const watching = Array.from({ length: 6 }, (_, id) => item(id));
Object.defineProperty(watching[2], "id", {
  enumerable: true,
  get() {
    seen.push("read");
    (watching[3] as any).late = "added during the walk";
    delete (watching[4] as any).price;
    watching.push(item(99));
    return -2;
  },
});
console.log(text(watching), seen.join());
class Priced { constructor(public id: number, public title: string) {} get label() { return this.title + "#" + this.id; } }
class Discounted extends Priced { off = 0.5; toJSON() { return { id: this.id, off: this.off }; } }
console.log(text([new Priced(1, "a"), new Priced(2, "b"), new Discounted(3, "c"), new Priced(4, "d")]));
const nested = Array.from({ length: 5 }, (_, id) => ({ id, rows: Array.from({ length: id }, (_, n) => item(n)), tail: "t" + id }));
console.log(text(nested));
console.log(text([[], [item(1)], [item(1), item(2)], [[item(3), item(4), item(5)]]]));
function local(id: number): number {
  const kept = [item(id), item(id + 1), item(id + 2)];
  return JSON.stringify(kept).length + JSON.stringify({ id, title: "t", price: id, inStock: true } satisfies Item).length;
}
console.log(local(1), local(1000), local(100000));
export {};
