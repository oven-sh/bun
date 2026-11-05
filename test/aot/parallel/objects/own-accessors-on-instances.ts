// Own accessors on the instances of classes and of constructor functions, under names that the classes declare or do not declare.
const lines: string[] = [];
function show(name: string, ...values: unknown[]) { lines.push(name + ": " + values.map(value => typeof value === "function" ? "function " + value.name : JSON.stringify(value) ?? String(value)).join(" | ")); }
function attempt(run: () => unknown): unknown { try { return run(); } catch (error) { return "threw " + (error as Error).name; } }

class Meter {
    declare reading: number;
    scale = 2;
    constructor(private raw: number) { Object.defineProperty(this, "reading", { get: () => this.raw * this.scale, enumerable: true, configurable: true }); }
    bump() { this.raw++; return this.reading; }
}
class Fine extends Meter {
    declare fine: string;
    constructor(raw: number) { super(raw); Object.defineProperty(this, "fine", { get() { return "fine " + (this as Fine).reading; }, enumerable: false, configurable: true }); }
}
function readMeter(m: Meter) { return m.reading; }
function readFine(f: Fine) { return f.fine + "/" + f.reading; }
const meter = new Meter(3), fine = new Fine(5);
show("instances", readMeter(meter), readMeter(fine), readFine(fine), meter.bump(), Object.keys(meter), Object.keys(fine), JSON.stringify(fine));
Object.defineProperty(meter, "reading", { value: 100, writable: true, configurable: true, enumerable: true });
show("made a value", readMeter(meter), meter.bump(), attempt(() => { meter.reading = 7; return readMeter(meter); }), readMeter(new Meter(1)));
delete (fine as any).reading;
show("deleted", readMeter(fine), readFine(fine), "reading" in fine);
(Meter.prototype as any).reading = "from the prototype";
show("inherited", readMeter(fine), readFine(fine), readMeter(new Meter(2)));
delete (Meter.prototype as any).reading;

// A field that some instances hold as a value and others as an accessor.
class Either {
    declare held: unknown;
    constructor(lazy: boolean, value: unknown) { if (lazy) Object.defineProperty(this, "held", { get: () => value, enumerable: true, configurable: true }); else this.held = value; }
}
function readEither(e: Either) { return e.held; }
show("either", readEither(new Either(true, "lazy")), readEither(new Either(false, "eager")), Object.getOwnPropertyDescriptor(new Either(true, 1), "held")!.get !== undefined, Object.getOwnPropertyDescriptor(new Either(false, 1), "held")!.value);

// A getter and a setter, defined together and one after the other.
class Pair {
    declare both: number;
    store = 0;
    constructor() {
        Object.defineProperty(this, "both", { get: () => this.store, set: (v: number) => { this.store = v * 2; }, enumerable: true, configurable: true });
    }
}
function usePair(p: Pair) { p.both = 4; const first = p.both; p.both += 1; return [first, p.both, p.store]; }
show("pair", usePair(new Pair()), usePair(new Pair()));
const half = new Pair();
Object.defineProperty(half, "both", { set: undefined });
show("setter taken away", half.both, attempt(() => { "use strict"; half.both = 1; return "stored"; }), typeof Object.getOwnPropertyDescriptor(half, "both")!.get);
Object.defineProperty(half, "both", { get: undefined });
show("getter taken away", half.both, Object.getOwnPropertyDescriptor(half, "both"));

// Constructor functions.
function Old(this: any, n: number) { Object.defineProperty(this, "twice", { get() { return n * 2; }, enumerable: true, configurable: true }); this.n = n; }
function readOld(o: any) { return o.twice + o.n; }
show("constructor function", readOld(new (Old as any)(4)), readOld(new (Old as any)(5)), Object.keys(new (Old as any)(1)));

// this of the getter, through Reflect.get and super.
const own = { base: 10, get viaThis() { return this.base; } };
function readViaThis(o: typeof own) { return o.viaThis; }
show("receiver", readViaThis(own), Reflect.get(own, "viaThis", { base: 20 }), Object.create(own, { base: { value: 30 } }).viaThis);

// A getter that throws, that redefines itself, that deletes itself.
const odd: any = {
    get thrower() { throw new RangeError("no"); },
    get once() { Object.defineProperty(this, "once", { value: "settled", configurable: true, enumerable: true }); return "first"; },
    get gone() { delete this.gone; return "was here"; },
};
function readOdd(name: "thrower" | "once" | "gone") { return name === "thrower" ? odd.thrower : name === "once" ? odd.once : odd.gone; }
show("odd", attempt(() => readOdd("thrower")), readOdd("once"), readOdd("once"), readOdd("gone"), readOdd("gone"), Object.keys(odd));

let total = 0;
for (let i = 0; i < 20000; i++) { const m = i & 1 ? new Fine(i) : new Meter(i); total += readMeter(m); if (i % 5000 === 0) Bun.gc(true); }
show("many", total);
console.log(lines.join("\n"));
