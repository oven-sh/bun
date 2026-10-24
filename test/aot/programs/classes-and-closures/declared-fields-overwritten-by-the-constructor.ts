// A declared field is defined as undefined before the constructor's body runs. Where the body always stores again nobody sees that value, and every way to see it still works.
const seed: number = parseInt(process.argv[2] ?? "3", 10);
const seen: unknown[] = [];
function note(value: unknown): void { seen.push(value === undefined ? "undefined" : value); }

class Filled {
    count: number; ratio: number; on: boolean; label: string; next: Filled; parent: Filled | null; list: number[];
    constructor(n: number) {
        this.list = [n]; this.parent = null; this.next = this; this.label = "n" + n; this.on = n > 1; this.ratio = n + 0.5; this.count = n | 0;
    }
}
const filled = new Filled(seed);
note(Object.keys(filled).join());
note(JSON.stringify({ ...filled, next: 0 }));
note(filled.next.next.count ^ 5);
note(filled.count + filled.ratio);

class FilledOnOnePath { count!: number; constructor(n: number) { if (n > 100) this.count = n; } }
note(new FilledOnOnePath(seed).count);
note(new FilledOnOnePath(seed + 200).count);
note("count" in new FilledOnOnePath(seed));

class NeverFilled { count!: number; }
note(new NeverFilled().count);
note(Object.keys(new NeverFilled()).join());

class ReadsFirst { count!: number; before: unknown; constructor(n: number) { this.before = this.count; this.count = n; } }
note(new ReadsFirst(seed).before);

class MethodReadsFirst { count!: number; constructor(n: number) { this.look(); this.count = n; } look(): void { note(this.count); } }
note(new MethodReadsFirst(seed).count);

let registered: LeaksFirst | undefined;
function lookAtRegistered(): void { note(registered!.count); }
class LeaksFirst { count: number; constructor(n: number) { registered = this; lookAtRegistered(); this.count = n; } }
note(new LeaksFirst(seed).count);

class EnumeratesFirst { count: number; label: string; constructor(n: number) { note(JSON.stringify(this)); note(Object.keys(this).join()); this.label = "l"; this.count = n; } }
note(Object.keys(new EnumeratesFirst(seed)).join());

class TestsFirst { count: number; constructor(n: number) { note("count" in this); note(Object.hasOwn(this, "count")); this.count = n; } }
note(new TestsFirst(seed).count);

class FilledByMethod { count!: number; constructor(n: number) { this.reset(n); } reset(n: number): void { this.count = n * 2; } }
note(new FilledByMethod(seed).count);

class Parent { constructor() { this.start(); } start(): void { } }
class ReadWhileParentRuns extends Parent { count: number; constructor(n: number) { super(); this.count = n; } start(): void { note(this.count); note("count" in this); } }
note(new ReadWhileParentRuns(seed).count);

class StoredWhileParentRuns extends Parent { count!: number; constructor() { super(); } start(): void { this.count = 7; } }
note(new StoredWhileParentRuns().count);

let lastBuilt: Registering | undefined;
class Registering { constructor() { lastBuilt = this; } }
function lookAtLastBuilt(): void { note((lastBuilt as ChildOfRegistering).count); }
class ChildOfRegistering extends Registering { count: number; constructor(n: number) { super(); lookAtLastBuilt(); this.count = n; } }
note(new ChildOfRegistering(seed).count);

class Shape { sides: number; kind!: string; constructor() { this.sides = 3; } }
class Square extends Shape { constructor() { super(); this.sides = 4; this.kind = "square"; } }
note(new Shape().kind); note(new Shape().sides); note(new Square().kind); note(new Square().sides); note(Object.keys(new Square()).join());

class InitializedThenOverwritten { label: unknown = 0; total = 1; constructor(n: number) { this.label = "s" + n; this.total = this.total + n; } }
note(new InitializedThenOverwritten(seed).label); note(new InitializedThenOverwritten(seed).total);

class ThrowsBeforeStore {
    count!: number;
    constructor(fail: boolean) { try { if (fail) throw new Error("no"); this.count = 1; } catch { note("caught"); } }
}
note(new ThrowsBeforeStore(true).count); note(new ThrowsBeforeStore(false).count);

class Private {
    #count: number; #label = "a";
    constructor(n: number) { this.#count = n | 0; }
    get count(): number { return this.#count; }
    get label(): string { return this.#label; }
    static has(value: object): boolean { return #count in value; }
}
note(new Private(seed).count ^ 1); note(new Private(seed).label); note(Private.has(new Private(seed))); note(Private.has({}));

class PrivateReadFirst { #count!: number; before: unknown; constructor(n: number) { this.before = this.#count; this.#count = n; } get count(): number { return this.#count; } }
note(new PrivateReadFirst(seed).before); note(new PrivateReadFirst(seed).count);

class ParameterProperties { constructor(public count: number, readonly label: string, private hidden: boolean) { } show(): string { return this.count + this.label + this.hidden; } }
note(new ParameterProperties(seed, "p", true).show()); note(Object.keys(new ParameterProperties(seed, "p", true)).join());

class Frozen { count: number; constructor(n: number) { this.count = n; Object.freeze(this); } }
note(new Frozen(seed).count); note(Object.isFrozen(new Frozen(seed)));

class ClosureSeesIt { count!: number; read: () => unknown = () => this.count; before: unknown; constructor(n: number) { this.before = this.read(); this.count = n; } }
note(new ClosureSeesIt(seed).before); note(new ClosureSeesIt(seed).read());

class ReturnsEarly { count!: number; constructor(n: number) { if (n < 100) return; this.count = n; } }
note(new ReturnsEarly(seed).count);

console.log(seen.join(" | "));
