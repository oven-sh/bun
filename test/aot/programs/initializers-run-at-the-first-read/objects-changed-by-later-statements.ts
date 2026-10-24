// What an initializer has made is changed by later statements of the module and by functions.
const table: Record<string, number> = { a: 1 };
table.b = 2;
const sizeThen = Object.keys(table).length;
table.c = 3;
const list: number[] = [];
for (let i = 0; i < 5; i++) list.push(i * i);
const total = list.reduce((sum, n) => sum + n, 0);
list.push(100);
const map = new Map<string, number>();
map.set("x", 1);
const seen = map.size;
map.set("y", 2);
function Legacy(this: any) { this.v = 1; }
Legacy.prototype.twice = function () { return this.v * 2; };
(Legacy as any).label = "legacy";
const frozen = Object.freeze({ a: 1 });
let refused = "";
try { "use strict"; (frozen as any).a = 2; } catch (error) { refused = (error as Error).constructor.name; }
const sealedLater = { a: 1 };
const before = Object.isSealed(sealedLater);
Object.seal(sealedLater);
function main() {
  console.log(JSON.stringify(table), sizeThen, list.join(), total, seen, map.size);
  console.log(new (Legacy as any)().twice(), (Legacy as any).label, refused, frozen.a, before, Object.isSealed(sealedLater));
}
main();
