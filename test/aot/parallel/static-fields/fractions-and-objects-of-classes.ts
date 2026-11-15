// Static fields that hold fractions and objects, read inside the class while it is made, behind it, and after the class has changed.
const K: any = JSON.parse("3"), key: any = JSON.parse('"A"'), said: string[] = [];
class Physics { static readonly G = 9.81; static readonly STEP = 0.5; static ZERO = -0; static NONE = NaN; static readonly LIST = [0.25, 0.75]; }
function fall(v: number): string { return `${v * Physics.G} ${Physics.STEP - v} ${Object.is(Physics.ZERO, -0)} ${Physics.NONE !== Physics.NONE} ${Physics.LIST[1]}`; }
console.log(fall(2), fall(-0.5));
class Config { static G = 1.5; static instance: Config = new Config(); limit = 7; seen = String(Config.G) + String(Config.instance); static own(): string { return `${Config.instance.limit} ${Config.G}`; } }
function limit(): number { return Config.instance.limit + Config.G; }
console.log(limit(), Config.own(), Config.instance.seen); Config.instance = new Config(); console.log(limit(), Config.instance.seen);
class Early { static A = Early.read(); static B = 2.5; static C = Early.read(); static read(): string { return `${Early.B} ${Early.C}`; } }
function early(): string { return `${Early.A}|${Early.B}|${Early.C}`; }
console.log(early());
class Twice { static A = 0.5; static B = said.push("between"); static D = Twice.A; }
function twice(): number { return Twice.A * 2 + Twice.D; } console.log(twice(), said.join());
class Stored { static A = 0.5; static set(x: number): void { Stored.A = x; } }
function stored(): number { return Stored.A * 2; } console.log(stored()); Stored.set(0.25); console.log(stored());
class Deleted { static A?: number[] = [1, 2]; }
function deleted(): string { return String(Deleted.A); } console.log(deleted()); delete Deleted.A; console.log(deleted());
class Keyed { static A: any = { q: 1 }; static B = 0.5; }
function keyed(): string { return `${JSON.stringify(Keyed.A)} ${Keyed.B}`; } console.log(keyed()); (Keyed as any)[key] = "other"; console.log(keyed());
class Defined { static A = 0.5; static B: any = [1]; }
function defined(): string { return `${Defined.A} ${Defined.B}`; } console.log(defined()); Object.defineProperty(Defined, "A", { get: () => 9.5 }); Object.defineProperty(Defined, "B", { get: () => 8 }); console.log(defined());
class Frozen { static A = 0.5; static B = [1.5]; } Object.freeze(Frozen); function frozen(): number { return Frozen.A + Frozen.B[0]!; } console.log(frozen(), Object.keys(Frozen).join(), frozen());
class Listed { static A = 0.5; static B = [1.5]; static get C(): number { return Listed.B[0]!; } } function listed(): number { return Listed.A + Listed.B.length + Listed.C; } console.log(listed(), Reflect.ownKeys(Listed).length, listed());
class Block { static A = 0.5; static B: any = null; static { Block.A = K; Block.B = { k: K }; } } function block(): string { return `${Block.A} ${Block.B.k}`; } console.log(block());
class Parent { static A = 0.5; static B = [1]; } class Heir extends Parent { static C = 2.5; } function heir(): string { return `${Heir.A} ${Heir.B} ${Heir.C}`; } console.log(heir()); (Heir as any).A = 4; console.log(heir(), Parent.A);
const Made = class Named { static A = 0.5; static B = Named.A; static C: any = [Named]; }; function made(): string { return `${Made.A} ${Made.B} ${Made.C[0] === Made}`; } console.log(made());
function maker(x: number): any { return class { static A = x; static B = 0.5; }; } const One = maker(0.25), Two = maker(7); function both(): string { return `${One.A} ${Two.A} ${One.B} ${Two.B}`; } console.log(both());
class Throws { static A = 0.5; static B = [1]; static f(): string { return `${Throws.A} ${Throws.B}`; } static C = K > 2 ? Throws.f() : 1; } console.log(Throws.C);
let Failed: any; try { class F { static A = 0.5; static B = [1]; static { Failed = F; throw new RangeError("stop"); } static C = [2]; } console.log(F.C); } catch (e: any) { console.log(e.name, Failed.A, Failed.B, Failed.C); }
let sum = 0; for (let i = 0; i < 10; i++) { sum += Physics.G; if (Config.instance) sum += Config.instance.limit; sum -= Physics.LIST[0]!; } console.log(sum);
export {};
