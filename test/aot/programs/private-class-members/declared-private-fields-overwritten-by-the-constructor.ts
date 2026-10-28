// A declared private field is defined as undefined before the constructor's body runs. Where the body always stores again nobody sees that value, and the field stays in its slot.
// Every way to see the value still works.
// COUNTER: FieldsLeftSlotByStoreOfOtherType = 0
const seed: number = parseInt(process.argv[2] ?? "3", 10);
const seen: unknown[] = [];
function note(value: unknown): void { seen.push(value === undefined ? "undefined" : value); }

class Filled {
    #count: number; #ratio: number; #on: boolean; #label: string; #next: Filled; #parent: Filled | null; #list: number[];
    constructor(n: number) {
        this.#list = [n]; this.#parent = null; this.#next = this; this.#label = "n" + n; this.#on = n > 1; this.#ratio = n + 0.5; this.#count = n | 0;
    }
    show(): string { return [this.#count, this.#ratio, this.#on, this.#label, this.#next.#next.#count ^ 5, this.#parent, this.#list.join()].join(); }
}
note(new Filled(seed).show());
note(Object.keys(new Filled(seed)).length);
let total = 0;
class Counted { #a: number; #b = 2; #c: string; constructor(a: number, c: string) { this.#a = a; this.#c = c; } sum(): number { return this.#a + this.#b + this.#c.length; } }
for (let i = 0; i < 1000; i++)
    total += new Counted(i + seed, "ab").sum();
note(total);

class FilledOnOnePath { #count!: number; constructor(n: number) { if (n > 100) this.#count = n; } get count(): unknown { return this.#count; } }
note(new FilledOnOnePath(seed).count);
note(new FilledOnOnePath(seed + 200).count);

class NeverFilled { #count!: number; get count(): unknown { return this.#count; } static has(value: object): boolean { return #count in value; } }
note(new NeverFilled().count);
note(NeverFilled.has(new NeverFilled()));

class ReadsFirst { #count!: number; before: unknown; constructor(n: number) { this.before = this.#count; this.#count = n; } get count(): number { return this.#count; } }
note(new ReadsFirst(seed).before); note(new ReadsFirst(seed).count);

class MethodReadsFirst { #count!: number; constructor(n: number) { this.look(); this.#count = n; } look(): void { note(this.#count); } }
new MethodReadsFirst(seed).look();

class PrivateMethodReadsFirst { #count!: number; constructor(n: number) { this.#look(); this.#count = n; this.#look(); } #look(): void { note(this.#count); } }
new PrivateMethodReadsFirst(seed);

let registered: LeaksFirst | undefined;
class LeaksFirst { #count: number; constructor(n: number) { registered = this; LeaksFirst.lookAtRegistered(); this.#count = n; } static lookAtRegistered(): void { note(registered!.#count); } }
new LeaksFirst(seed); LeaksFirst.lookAtRegistered();

class TestsFirst { #count: number; constructor(n: number) { note(#count in this); this.#count = n; } get count(): number { return this.#count; } }
note(new TestsFirst(seed).count);

class AddsFirst { #count!: number; constructor(n: number) { this.#count += n; } get count(): number { return this.#count; } }
note(String(new AddsFirst(seed).count));

class FilledByMethod { #count!: number; constructor(n: number) { this.reset(n); } reset(n: number): void { this.#count = n * 2; } get count(): number { return this.#count; } }
note(new FilledByMethod(seed).count);

class Parent { constructor() { this.start(); } start(): void { } }
class AbsentWhileParentRuns extends Parent {
    #count: number;
    constructor(n: number) { super(); this.#count = n; }
    start(): void { note(#count in this); try { note(this.#count); } catch (error) { note((error as Error).constructor.name); } }
    get count(): number { return this.#count; }
}
note(new AbsentWhileParentRuns(seed).count);

let lastBuilt: Registering | undefined;
class Registering { constructor() { lastBuilt = this; } }
class ChildOfRegistering extends Registering {
    #count: number;
    constructor(n: number) { super(); ChildOfRegistering.lookAtLastBuilt(); this.#count = n; }
    static lookAtLastBuilt(): void { note((lastBuilt as ChildOfRegistering).#count); }
}
new ChildOfRegistering(seed); ChildOfRegistering.lookAtLastBuilt();

class Returning { constructor(given: object) { return given; } }
class Stamped extends Returning {
    #count: number;
    constructor(given: object, n: number) { super(given); this.#count = n; }
    static read(value: object): unknown { return #count in value ? (value as Stamped).#count : "absent"; }
}
const plain = { name: "plain" };
note(Stamped.read(plain)); new Stamped(plain, seed); note(Stamped.read(plain));
try { new Stamped(plain, seed + 1); } catch (error) { note((error as Error).constructor.name); }
note(Stamped.read(plain));

class PublicAndPrivate { count: number; #count: number; label: string; constructor(n: number) { this.#count = n; this.count = n + 1; this.label = "l" + this.#count; } show(): string { return this.count + this.label + this.#count; } }
note(new PublicAndPrivate(seed).show()); note(Object.keys(new PublicAndPrivate(seed)).join());

class InitializedThenOverwritten { #label: unknown = 0; #total = 1; constructor(n: number) { this.#label = "s" + n; this.#total = this.#total + n; } show(): string { return this.#label + "," + this.#total; } }
note(new InitializedThenOverwritten(seed).show());

class ThrowsBeforeStore {
    #count!: number;
    constructor(fail: boolean) { try { if (fail) throw new Error("no"); this.#count = 1; } catch { note("caught"); } }
    get count(): unknown { return this.#count; }
}
note(new ThrowsBeforeStore(true).count); note(new ThrowsBeforeStore(false).count);

let escaped: ThrowsOut | undefined;
class ThrowsOut {
    #count: number;
    constructor(n: number) { escaped = this; if (n < 100) throw new Error("out"); this.#count = n; }
    static read(): unknown { return escaped!.#count; }
}
try { new ThrowsOut(seed); } catch { note(ThrowsOut.read()); }

class ClosureSeesIt { #count!: number; read: () => unknown = () => this.#count; before: unknown; constructor(n: number) { this.before = this.read(); this.#count = n; } }
note(new ClosureSeesIt(seed).before); note(new ClosureSeesIt(seed).read());

class ReturnsEarly { #count!: number; constructor(n: number) { if (n < 100) return; this.#count = n; } get count(): unknown { return this.#count; } }
note(new ReturnsEarly(seed).count);

function makeClass(step: number) {
    return class Made { #count: number; constructor(n: number) { this.#count = n + step; } get count(): number { return this.#count; } static has(value: object): boolean { return #count in value; } };
}
const First = makeClass(1), Second = makeClass(2);
note(new First(seed).count); note(new Second(seed).count); note(First.has(new Second(seed))); note(Second.has(new Second(seed)));

console.log(seen.join(" | "));
