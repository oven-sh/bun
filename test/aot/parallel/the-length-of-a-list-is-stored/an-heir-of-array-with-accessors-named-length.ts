const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
class Heir extends Array<number> { seen = 0; }
Object.defineProperty(Heir.prototype, "length", { get() { return -1; }, set(_: number) { console.log("never"); }, configurable: true });
Object.defineProperty(Array.prototype, "length", { value: 0, writable: false });
function cut(list: number[], to: number): string { list.length = to >>> 0; return list.length + ":" + list.join(); }
const heir = new Heir(); heir.push(1, 2, 3, 4);
console.log(cut(heir, numbers[4]!), cut(heir, numbers[2]!), cut(heir, numbers[2]!), heir instanceof Heir, cut([1, 2, 3], numbers[1]!));
