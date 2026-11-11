// answers: without-library
// # `#x: number; constructor(x) { this.#x = x }`: a private field is born with what the row stores, found by the binding of its name; the brand of private methods spoils nothing. `t: number[] = []` beside `x: number`: a
// # literal that names nothing may be made later, so `x` is born too; a store to a field with such an initializer joins the row. What must stay: two objects have two lists, two regular expressions; `#y in earlier` amid the
// # row; a look amid it sees what is laid; the class made twice keeps its names apart; a class below with a name of its own; a private accessor is no field; an initializer that calls or spreads refuses as before.
// # f3 = sums, f4 = trails
// # RUN(FORM): walk f3 f4 mechanisms=all
// # FORM-LABEL: code f3:Body
// # FORM: : number @Double = GetSlot {{*}}key=#"#x"@L0
// # FORM: : i32 @Int64 = GetSlot {{*}}key=#"#y"@L0
// # FORM-LABEL: code f4:Body
// # FORM: : number @Double = GetSlot {{*}}key="x"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const seen: unknown[] = [];
function look(object: object): number { seen.push(Object.keys(object).join() + ":" + JSON.stringify(object)); return seen.length; }
function drain(): string { return seen.splice(0).join("|"); }

class Hidden { #x: number; #y: number; constructor(x: number, y: number) { this.#y = y; this.#x = x; } sum(): number { return this.#x + this.#y * 2; } static has(value: object): boolean { return #x in value; } }
function sums(list: Hidden[]): number { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].sum(); return total; }
report(sums([new Hidden(0.5, 1), new Hidden(1.25, 2)]));
report(Hidden.has(new Hidden(1, 2)) + ":" + Hidden.has({}));

class Trail { x: number; t: number[] = []; o = { a: 1, b: [2, 3] }; constructor(x: number) { this.x = x; } }
function trails(list: Trail[]): number { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].x + list[i].t.length; return total; }
const first = new Trail(0.5), second = new Trail(1.5);
first.t.push(7);
first.o.b.push(4);
report(trails([first, second]) + ":" + second.t.length + ":" + second.o.b.length + ":" + (first.t !== second.t) + ":" + (first.o !== second.o));

class Shown { x: number; t: number[] = []; big = 10n; match = /a+/g; text = `plain`; constructor(x: number) { this.x = x; } }
report(Object.keys(new Shown(1)).join() + ":" + new Shown(1).big + ":" + new Shown(1).match.source + ":" + new Shown(1).text + ":" + (new Shown(1).match !== new Shown(1).match));

class Counted { count = 0; name: string; list: number[] = [1]; constructor(name: string, count: number) { this.count = count; this.name = name; } }
report(Object.keys(new Counted("n", 5)).join() + JSON.stringify(new Counted("n", 5)));

class WithMethod { n: number; constructor(readonly r: string, n: number) { this.n = n; } #m(): number { return this.n * 2; } get m(): number { return this.#m(); } }
report(new WithMethod("r", 4).m + Object.keys(new WithMethod("r", 4)).join());

class AsksAmid { #x: number; #y: number; constructor(x: number, earlier: object | null) { this.#x = x; seen.push(earlier !== null && #y in earlier); this.#y = x + 1; } both(): number { return this.#x + this.#y; } }
const early = new AsksAmid(1, null);
report(new AsksAmid(2, early).both() + drain());

class HandsOutAmid { #x: number; y: number; constructor(x: number) { this.#x = x; look(this); this.y = x; } x(): number { return this.#x; } }
report(new HandsOutAmid(3).x() + drain());

class ReadsItself { n = 0; #x: number; constructor(n: number) { this.n = n; this.#x = this.n + 1; } x(): number { return this.#x; } }
report(new ReadsItself(4).x());

class Returns { n = 0; #x: number | undefined; constructor(n?: number) { if (n) return; this.#x = 1; } x(): unknown { return this.#x; } }
report(String(new Returns(1).x()) + ":" + new Returns().x());

function make(): { new (x: number): { x(): number; same(other: object): boolean } } { return class { #x: number; constructor(x: number) { this.#x = x; } x(): number { return this.#x; } same(other: object): boolean { return #x in other; } }; }
const One = make(), Two = make();
report(new One(1).x() + new Two(2).x() + ":" + new One(1).same(new One(2)) + ":" + new One(1).same(new Two(2)));

class Below extends Hidden { #x: string; constructor() { super(1, 2); this.#x = "below"; } own(): string { return this.#x; } }
report(new Below().own() + new Below().sum());

class Accessor { #held: number; constructor(held: number) { this.#held = held; this.#double = held; } get #double(): number { return this.#held * 2; } set #double(value: number) { this.#held = value + 1; } read(): number { return this.#double; } }
report(new Accessor(3).read());

class Throws { #x: number; t: number[] = []; constructor(x: number) { if (x < 0) throw new Error("below"); this.#x = x; } x(): number { return this.#x; } }
try { new Throws(-1); } catch (error) { report((error as Error).message + new Throws(2).x()); }

class Calls { id = look(seen); x: number; constructor(x: number) { this.x = x; } }
report(JSON.stringify(new Calls(1)) + seen.splice(0).length);

class Spreads { base: number[] = [...[1, 2]]; x: number; constructor(x: number) { this.x = x; } }
report(JSON.stringify(new Spreads(1)));
report("end");
