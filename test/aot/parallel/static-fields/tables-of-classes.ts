// Static fields that hold tables which the engine makes of primitives, read inside their class and in loops, before and behind code of other classes.
const K: any = JSON.parse("3"), said: any[] = [];
class Box { static readonly SUB = new Uint8Array(256); static readonly SHIFT = 2 ** 3 - 1; static readonly ROUNDS = new Int32Array([1, 2, 4, 8]); static fill(): void { for (let i = 0; i < 256; i++) Box.SUB[i] = (i * 7 + 99) & 255; } static sub(x: number): number { return Box.SUB[x & 255]!; } static round(x: number): number { return Box.ROUNDS[x & 3]! << Box.SHIFT; } }
Box.fill(); let sum = 0; for (let i = 0; i < 600; i++) sum = (sum * 3 + Box.sub(i) + Box.round(i)) | 0; console.log(sum, Box.SUB.length, Box.SHIFT);
class Registry { static readonly items = new Map<string, number>(); static readonly seen = new Set<string>(); static readonly owners = new WeakMap<object, string>(); static put(name: string, value: number): void { if (Registry.seen.has(name)) return; Registry.seen.add(name); Registry.items.set(name, value); } static get(name: string): number { return Registry.items.get(name) ?? -1; } }
for (const name of ["a", "b", "a"]) Registry.put(name, name.charCodeAt(0)); console.log(Registry.get("a"), Registry.get("c"), Registry.items.size, Registry.owners.has(Registry));
class Reader { static before = Reader.look(); static table = new Float64Array(2); static between = Reader.look(); static late = new Map([[1, K]]); static behind = Reader.look(); static look(): string { return `${Reader.table?.length} ${Reader.late?.size}`; } }
console.log(Reader.before, "|", Reader.between, "|", Reader.behind);
class Sized { static buffer = new ArrayBuffer(K * 4); static view = new Int32Array(Sized.buffer); static count = -1 + 2 * 3; static set(i: number, x: number): void { Sized.view[i] = x; } }
Sized.set(1, 9); console.log(Sized.view.join(), Sized.buffer.byteLength, Sized.count);
class Wrong { static make(): any { try { return class { static a = new Uint8Array(-1); static b = said.push("never"); }; } catch (e: any) { return e.name; } } }
console.log(Wrong.make(), said.length);
class Converts { static a = new Uint8Array({ valueOf() { said.push(typeof (Converts as any).b); return 2; } } as any); static b = new Uint8Array(3); }
console.log(Converts.a.length, Converts.b.length, said.join());
class Adder extends Map<number, number> { override set(k: number, v: number): this { said.push("set"); return super.set(k, v); } } class Filled { static own = new Adder([[1, 2]]); static rest = new Set([1]); }
console.log(Filled.own.get(1), Filled.rest.size, said.join());
class Swapped { static table = new Uint8Array(4); static use(i: number): number { return Swapped.table[i]!; } }
let seen = ""; for (let i = 0; i < 4; i++) { seen += Swapped.use(i); if (i === 1) Swapped.table = new Uint8Array([7, 7, 7, 7]); } console.log(seen);
export {};
