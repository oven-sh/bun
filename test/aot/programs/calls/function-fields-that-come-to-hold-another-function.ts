// Roads by which a field that the typed program assigns one function expression to comes to hold another function.
const lines: string[] = [];
type Fn = (x: number) => number;
const others: Fn[] = [x => x * 100, x => x * 1000];
function pick(i: number): Fn { return others[i & 1]; }
function callAll<T extends { f: Fn }>(label: string, list: T[]): void { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].f(i + 1); lines.push(label + ": " + sum); }

class A1 { k = 1; f: Fn = x => x + 1; }
{ const list: A1[] = []; for (let i = 0; i < 4; i++) list.push(new A1()); let s = 0; for (const a of list) s += a.f(1); Object.assign(list[1], { f: pick(0) }); for (const a of list) s += a.f(1); lines.push("Object.assign: " + s); }

class A2 { k = 1; g2: Fn = x => x + 2; }
{ const list: A2[] = []; for (let i = 0; i < 4; i++) list.push(new A2()); let s = 0; for (const a of list) s += a.g2(1); Reflect.set(list[1], "g2", pick(0)); for (const a of list) s += a.g2(1); lines.push("Reflect.set: " + s); }

class A3 { k = 1; g3: Fn = x => x + 3; }
{ const list: A3[] = []; for (let i = 0; i < 4; i++) list.push(new A3()); let s = 0; for (const a of list) s += a.g3(1); Object.defineProperty(list[1], "g3", { value: pick(0), writable: true, enumerable: true, configurable: true }); for (const a of list) s += a.g3(1); lines.push("Object.defineProperty: " + s); }

class A4 { k = 1; g4: Fn = x => x + 4; }
{ const list: A4[] = []; for (let i = 0; i < 4; i++) list.push(new A4()); let s = 0; for (const a of list) s += a.g4(1); const key: string = ["g", "4"].join(""); (list[1] as any)[key] = pick(0); for (const a of list) s += a.g4(1); lines.push("a computed key: " + s); }

interface R5 { k: number; g5: Fn }
interface S5 { k: number; g5: Fn; extra?: number }
function make5(k: number): R5 { return { k, g5: x => x + 5 }; }
{ const from: S5 = JSON.parse('{"k":7}'); from.g5 = pick(0); const list: R5[] = []; for (let i = 0; i < 4; i++) list.push(make5(i)); let s = 0; for (const a of list) s += a.g5(1); const copy: R5 = { ...from }; list.push(copy); for (const a of list) s += a.g5(1); lines.push("a spread of another object: " + s); }

class A6 { k = 1; g6: Fn = x => x + 6; }
class B6 extends A6 { constructor(f: Fn) { super(); this.g6 = f; } }
{ const list: A6[] = []; for (let i = 0; i < 4; i++) list.push(new A6()); let s = 0; for (const a of list) s += a.g6(1); list.push(new B6(pick(1))); for (const a of list) s += a.g6(1); lines.push("a subclass stores: " + s); }

class A7 { k = 1; g7: Fn = x => x + 7; }
{ const list: A7[] = []; for (let i = 0; i < 4; i++) list.push(new A7()); let s = 0; for (const a of list) s += a.g7(1); const untyped: any = list[2]; untyped.g7 = pick(1); for (const a of list) s += a.g7(1); lines.push("an untyped store: " + s); }

class A8 { k = 1; g8: Fn = x => x + 8; }
{ const list: A8[] = []; for (let i = 0; i < 4; i++) list.push(new A8()); let s = 0; for (const a of list) s += a.g8(1); delete (list[2] as any).g8; (list[2] as any).g8 = pick(1); for (const a of list) s += a.g8(1); lines.push("deleted, then stored: " + s); }

class A9 { k = 1; g9: Fn = x => x + 9; }
{ const list: A9[] = []; for (let i = 0; i < 4; i++) list.push(new A9()); let s = 0; for (const a of list) s += a.g9(1); const [first, second] = list; [first.g9, second.g9] = [pick(0), pick(1)]; for (const a of list) s += a.g9(1); lines.push("destructuring assignment: " + s); }

class A10 { k = 1; g10: Fn = x => x + 10; }
{ const list: A10[] = []; for (let i = 0; i < 4; i++) list.push(new A10()); let s = 0; for (const a of list) s += a.g10(1); const made: A10 = Object.create(A10.prototype, { k: { value: 1, writable: true, enumerable: true, configurable: true }, g10: { value: pick(0), writable: true, enumerable: true, configurable: true } }); list.push(made); for (const a of list) s += a.g10(1); lines.push("Object.create with descriptors: " + s); }

class A11 { k = 1; g11: Fn = x => x + 11; }
{ const list: A11[] = []; for (let i = 0; i < 4; i++) list.push(new A11()); let s = 0; for (const a of list) s += a.g11(1); const clone: A11 = Object.assign(Object.create(A11.prototype), list[0], { g11: pick(1) }); list.push(clone); for (const a of list) s += a.g11(1); lines.push("a clone by Object.assign: " + s); }

class A12 { k = 1; g12: Fn = x => x + 12; swap(other: A12): void { const mine = this.g12; this.g12 = other.g12; other.g12 = mine; } }
{ const list: A12[] = []; for (let i = 0; i < 4; i++) list.push(new A12()); let s = 0; for (const a of list) s += a.g12(1); (list[3] as any).g12 = pick(0); list[0].swap(list[3]); for (const a of list) s += a.g12(1); lines.push("handed from object to object: " + s); }
console.log(lines.join("\n"));
