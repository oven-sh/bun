// Static fields that written constants fill, and classes whose static fields change by some road.
const K: any = JSON.parse("3"), key: any = JSON.parse('"MAX"');
class Plain { static readonly MAX: number = 1000; static MIN = 0; static ON = true; static NAME = "plain"; }
function plain(x: number): string { return `${x > Plain.MAX} ${x < Plain.MIN} ${Plain.ON ? "on" : "off"} ${Plain.NAME}`; }
console.log(plain(5), plain(2000), plain(-1));
class Stored { static MAX = 1; static set(x: number): void { Stored.MAX = x; } }
function stored(): number { return Stored.MAX * 2; }
console.log(stored()); Stored.set(4); console.log(stored());
class ByThis { static MAX = 1; static set(x: number): void { this.MAX = x; } }
class Heir extends ByThis { static other = 5; }
function byThis(): string { return `${ByThis.MAX} ${Heir.MAX} ${Heir.other}`; }
console.log(byThis()); Heir.set(7); console.log(byThis()); ByThis.set(8); console.log(byThis());
class Deleted { static MAX?: number = 1; }
function deleted(): string { return `${Deleted.MAX} ${"MAX" in Deleted}`; }
console.log(deleted()); delete Deleted.MAX; console.log(deleted());
class Keyed { static MAX = 1; static MIN = 2; }
function keyed(): string { return `${Keyed.MAX} ${Keyed.MIN}`; }
console.log(keyed()); (Keyed as any)[key] = 6; console.log(keyed());
class Defined { static MAX = 1; }
function defined(): number { return Defined.MAX; }
console.log(defined()); Object.defineProperty(Defined, "MAX", { get: () => 9 }); console.log(defined());
class Assigned { static MAX = 1; static MIN = 2; }
function assigned(): string { return `${Assigned.MAX} ${Assigned.MIN}`; }
console.log(assigned()); Object.assign(Assigned, { MIN: 5 }); console.log(assigned());
class Aliased { static MAX = 1; }
function aliased(): number { return Aliased.MAX; }
const alias = [Aliased, Plain][K - 3]!; console.log(aliased()); (alias as typeof Aliased).MAX = 3; console.log(aliased(), Plain.MAX);
class Early { static A = Early.read(); static MAX = 1; static read(): string { return String(Early.MAX); } }
console.log(Early.A, Early.read());
class Block { static MAX = 1; static { Block.MAX = K; } }
function block(): number { return Block.MAX; }
console.log(block());
function make(): any { return class { static MAX = 1; }; }
const One = make(), Two = make(); One.MAX = 2; function made(): string { return `${One.MAX} ${Two.MAX}`; }
console.log(made());
class Instance { static MAX = 1; }
function instance(): number { return Instance.MAX; }
console.log(instance()); (new Instance() as any).constructor.MAX = 4; console.log(instance());
const Expression = class { static MAX = 12; }; function expression(): number { return Expression.MAX + 1; }
console.log(expression()); (Expression as any).MAX++; console.log(expression());
class Frozen { static MAX = 1; } Object.freeze(Frozen); try { (Frozen as any).MAX = 2; } catch (e: any) { console.log(e.name); }
function frozen(): number { return Frozen.MAX; } console.log(frozen());
console.log(Object.keys(Plain).join(), Object.getOwnPropertyDescriptor(Plain, "MAX")!.value, Reflect.ownKeys(Stored).length);
let sum = 0; for (let i = 0; i < 10; i++) { if (i < Plain.MAX) sum += i; if (i === Plain.MIN) sum += 100; sum += Stored.MAX; } console.log(sum);
export {};
