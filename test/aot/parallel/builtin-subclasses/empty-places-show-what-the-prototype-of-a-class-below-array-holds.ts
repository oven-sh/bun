class Sparse extends Array<number> {
  sum(): number { let n = 0; for (let i = 0; i < this.length; i++) n += this[i] ?? 1000; return n; }
  each(): number { let n = 0; for (const v of this) n += v ?? 1000; return n; }
}
function read(list: Sparse, i: number): number | undefined { return list[i]; }
function store(list: Sparse, i: number, v: number): void { list[i] = v; }
const list = new Sparse(4); list[0] = 1; list[3] = 4;
for (let turn = 0; turn < 3; turn++) console.log(list.sum(), list.each(), read(list, 1), read(list, 9), read(list, -1), list.indexOf(7), list.includes(7), list.join());
(Sparse.prototype as any)[1] = 7;
for (let turn = 0; turn < 3; turn++) console.log(list.sum(), list.each(), read(list, 1), read(list, 9), read(list, -1), list.indexOf(7), list.includes(7), list.join(), [...list].join(), list.slice().join(), 1 in list, Object.hasOwn(list, 1));
Object.defineProperty(Sparse.prototype, 2, { get() { return 70; }, set(v) { console.log("set", v); }, configurable: true });
for (let turn = 0; turn < 3; turn++) { store(list, 2, turn); console.log(list.sum(), list.each(), read(list, 2), list.join(), Object.hasOwn(list, 2)); }
const grown = new Sparse(); Object.defineProperty(Sparse.prototype, 0, { set(v) { console.log("set 0", v); }, get() { return -1; }, configurable: true });
console.log(grown.push(5), grown.length, grown[0], Object.hasOwn(grown, 0)); store(grown, 0, 6); console.log(grown[0], grown.length);
delete (Sparse.prototype as any)[0]; delete (Sparse.prototype as any)[1]; delete (Sparse.prototype as any)[2];
console.log(list.sum(), list.each(), read(list, 1), list.join());
Object.setPrototypeOf(Sparse.prototype, { 1: 11, __proto__: Array.prototype });
console.log(list.sum(), list.each(), read(list, 1), list.join());
