// One typed call of a member after another, `holder.member(..)`, finds everything there that can stand in a member: closures of exactly its signature, of other signatures, functions that look at `this`, functions of the engine, what is no function at all.
const WITH_MESSAGES: boolean = false;
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }
function attempt(label: string, run: () => unknown): void { try { say(label, run()); } catch (error) { say(label, "threw " + (error instanceof Error ? error.constructor.name + (WITH_MESSAGES ? " " + error.message : "") : String(error))); } }
function show(n: number): string { return Object.is(n, -0) ? "-0" : String(n); }

interface Point { x: number; y: number }
interface Holder {
    tag: string;
    unary: (x: number) => number;
    test: (x: number) => boolean;
    join: (a: string, b: string) => string;
    measure: (p: Point) => number;
    make: (x: number, y: number) => Point;
    visit: (p: Point | undefined, depth: number) => Point | undefined;
    note: (p: Point) => void;
    maybe?: (x: number) => number;
    method(x: number): number;
    who(): string;
}
let noted = 0;
function holder(k: number): Holder {
    return {
        tag: "h" + k,
        unary: x => x + k,
        test: x => x > k,
        join: (a, b) => a + k + b,
        measure: p => p.x * k + p.y,
        make: (x, y) => ({ x: x + k, y: y - k }),
        visit: (p, depth) => p ? { x: p.x + k, y: p.y + depth } : undefined,
        note: p => { noted += p.x + k; },
        maybe: k & 1 ? x => x - k : undefined,
        method(x) { return x * k + this.tag.length; },
        who() { return this.tag; },
    };
}
function callUnary(h: Holder, x: number, depth: number): number { if (depth > 0) return callUnary(h, x, depth - 1); return h.unary(x); }
function callTest(h: Holder, x: number, depth: number): boolean { if (depth > 0) return callTest(h, x, depth - 1); return h.test(x); }
function callJoin(h: Holder, a: string, b: string, depth: number): string { if (depth > 0) return callJoin(h, a, b, depth - 1); return h.join(a, b); }
function callMeasure(h: Holder, p: Point, depth: number): number { if (depth > 0) return callMeasure(h, p, depth - 1); return h.measure(p); }
function callMake(h: Holder, x: number, y: number, depth: number): Point { if (depth > 0) return callMake(h, x, y, depth - 1); return h.make(x, y); }
function callVisit(h: Holder, p: Point | undefined, depth: number): Point | undefined { if (depth > 0) return callVisit(h, p, depth - 1); return h.visit(p, depth); }
function callNote(h: Holder, p: Point, depth: number): void { if (depth > 0) return callNote(h, p, depth - 1); h.note(p); }
function callMaybe(h: Holder, x: number, depth: number): string { if (depth > 0) return callMaybe(h, x, depth - 1); return String(h.maybe?.(x)) + " " + (h.maybe ? h.maybe(x) : "none") + " " + (h.maybe && h.maybe(x + 1)); }
function callMethod(h: Holder, x: number, depth: number): number { if (depth > 0) return callMethod(h, x, depth - 1); return h.method(x); }
function callWho(h: Holder, depth: number): string { if (depth > 0) return callWho(h, depth - 1); return h.who(); }
function callByKey(h: Holder, x: number, depth: number): number { if (depth > 0) return callByKey(h, x, depth - 1); return h["unary"](x) + (h.unary)(x) + h.unary!(x); }
function argumentsThatChangeTheMember(h: Holder, other: Holder, depth: number): number { if (depth > 0) return argumentsThatChangeTheMember(h, other, depth - 1); return h.unary((h.unary = other.unary, 1)); }
function sumThrough(h: Holder, times: number): number { let total = 0; for (let i = 0; i < times; i++) total += h.unary(i) + (h.test(i) ? 1 : 0); return total; }

class Walker {
    seen = 0;
    constructor(public tag: string, public onEach: (p: Point) => void, public weigh: (p: Point, scale: number) => number, public self: (this: Walker, x: number) => string) {}
    step(p: Point): number { this.onEach(p); return this.weigh(p, 2.5) + this.seen; }
    name(x: number): string { return this.self(x); }
}
function tagOf(this: Walker, x: number): string { return this.tag + x; }
function looksAtThis(this: unknown, x: number): number { return (this === undefined ? 1000 : typeof this === "object" ? 2000 : 3000) + x; }
function sloppy(x: number): number { return x + 0.5; }

const anything: any[] = [Math.abs, Math.sqrt, (x: any) => WITH_MESSAGES ? x + "!" : x + 1, function (this: any, x: any) { return WITH_MESSAGES ? typeof this + (this && this.tag) + x : (this && this.tag ? this.tag.length : -1) + x; }, holder(3).unary.bind(null), looksAtThis.bind("bound"), new Proxy(holder(5).unary, {}), new Proxy(holder(5).unary, { apply: (target, self, list) => target(list[0]) * 10 + (self ? self.tag.length : 0) }), Number, parseFloat];

for (let round = 0; round < 3; round++) {
    const h = holder(round), g = holder(round + 1);
    say("closures of the signature", [callUnary(h, 1, 2), callUnary(g, 1.5, 2), callUnary(holder(7), round, 2)].map(show).join(" "));
    say("numbers of every kind", [0, -0, 1, -1, 0.5, 2147483647, 2147483648, -2147483649, 9007199254740993, 1e308, Infinity, -Infinity, NaN].map(x => show(callUnary(holder(0), x, 2)) + "|" + show(callUnary(g, x, 2))).join(" "));
    say("booleans", [callTest(h, 1, 2), callTest(g, NaN, 2), callTest(g, 5, 2)].join(" "));
    say("strings", callJoin(h, "a", "b", 2) + " " + callJoin(g, "", "", 2).length + " " + callJoin(h, "x".repeat(3), "é", 2));
    say("objects in", callMeasure(h, { x: -3, y: 4 }, 2) + " " + callMeasure(g, { x: 0.25, y: 0 }, 2));
    const made = callMake(h, 1, 2, 2);
    say("objects out", made.x + "," + made.y);
    const moved = callVisit(h, made, 2), none = callVisit(g, undefined, 2);
    say("objects or nothing", (moved ? moved.x + "," + moved.y : "none") + " " + (none ? "some" : "none"));
    callNote(h, made, 2); callNote(g, made, 2);
    say("nothing comes back", noted);
    say("a member that may be missing", callMaybe(h, 10, 2) + " | " + callMaybe(g, 10, 2));
    say("methods of the literal", callMethod(h, 3, 2) + " " + callMethod(g, 3, 2) + " " + callWho(h, 2) + callWho(g, 2));
    say("by key, in parentheses, asserted", callByKey(h, 2, 2));
    say("in a loop", sumThrough(h, 100) + " " + sumThrough(g, 100));
    say("an argument stores to the member", argumentsThatChangeTheMember(holder(10), holder(20), 2));

    const walker = new Walker("w" + round, p => { noted += p.y; }, (p, scale) => p.x * scale + round, tagOf);
    say("members of a class instance", walker.step(made) + " " + walker.name(round) + " " + noted);
    walker.onEach = function (this: unknown, p: Point) { (this as Walker).seen += p.x; };
    say("a function that stores through this", walker.step(made) + " " + walker.seen);

    const changed = holder(round);
    changed.unary = looksAtThis;
    say("a function that looks at this", callUnary(changed, 1, 2));
    const free = changed.unary;
    say("the same without a receiver", free(1));
    changed.unary = sloppy;
    say("a declared function", callUnary(changed, 1, 2));
    changed.unary = () => 42 + round;
    changed.join = a => a + a;
    say("fewer parameters than are passed", callUnary(changed, 1, 2) + " " + callJoin(changed, "p", "q", 2));
    changed.unary = (x: number, y?: number) => x + (y === undefined ? 1000 : y);
    say("more parameters, optional", callUnary(changed, 1, 2));
    changed.unary = (x: number, ...rest: number[]) => x + rest.length;
    say("a rest parameter", callUnary(changed, 1, 2));
    changed.unary = (x: number | string) => typeof x === "number" ? x + 1 : -1;
    changed.measure = (p: { x: number }) => p.x;
    say("a wider parameter", callUnary(changed, 1, 2) + " " + callMeasure(changed, { x: 9, y: 9 }, 2));
    changed.unary = x => 5;
    changed.visit = p => p;
    say("a narrower result", callUnary(changed, 1, 2) + " " + (callVisit(changed, made, 2) === made));
    changed.unary = Math.floor;
    say("a function of the engine", callUnary(changed, 2.75, 2));
    changed.method = h.method;
    changed.who = g.who;
    say("methods moved to another object", callMethod(changed, 2, 2) + " " + callWho(changed, 2));
    changed.who = function (this: Holder) { return "function " + this.tag; };
    say("a function in place of a method", callWho(changed, 2));
    changed.who = () => "arrow";
    say("an arrow in place of a method", callWho(changed, 2));

    for (let i = 0; i < anything.length; i++) {
        const odd = holder(round);
        odd.unary = anything[i];
        attempt("what any hands over, " + i, () => callUnary(odd, 2.25 + round, 2));
    }
    const decorated = holder(round);
    (decorated.unary as any).extra = "e" + round;
    say("a closure that was given a property", callUnary(decorated, 1, 2) + " " + (decorated.unary as any).extra);
    const inherits: Holder = Object.create(holder(round + 4));
    say("members that are inherited", callUnary(inherits, 1, 2) + " " + callWho(inherits, 2) + " " + callMethod(inherits, 1, 2));
    const computed: Holder = Object.defineProperty(holder(round), "unary", { get(this: Holder) { return (x: number) => x + this.tag.length * 100; } });
    say("a member behind a getter", callUnary(computed, 1, 2));
    for (const what of [undefined, null, 0, 1.5, "text", true, {}, [], Symbol.iterator, 10n, class { }, /x/] as any[]) {
        const broken = holder(round);
        (broken as any).unary = what;
        (broken as any).who = what;
        const label = typeof what === "symbol" ? "symbol" : typeof what === "bigint" ? "bigint" : typeof what === "function" ? "class" : Array.isArray(what) ? "array" : what instanceof RegExp ? "regexp" : String(what);
        attempt("what is no function, " + label, () => callUnary(broken, 1, 2));
        attempt("what is no method, " + label, () => callWho(broken, 2));
    }
    attempt("no holder", () => callUnary(undefined as unknown as Holder, 1, 2));
    attempt("no holder either", () => callWho(null as unknown as Holder, 2));
    const throws = holder(round);
    throws.unary = x => { throw new RangeError("from inside " + (x + round)); };
    attempt("it throws", () => { try { return callUnary(throws, 1, 2); } catch (error) { return "caught " + (error as Error).message; } finally { lines.push("finally " + round); } });
    const endless = holder(round);
    endless.unary = x => callUnary(endless, x + 1, 0) + 1;
    attempt("it never ends", () => callUnary(endless, 0, 2));
    const busy = holder(round);
    busy.unary = x => { let held: unknown[] = []; for (let i = 0; i < 2000; i++) held = [held.length, { i, x }, "s" + i]; return held.length + x; };
    say("it allocates", callUnary(busy, round, 2));
    const nested = holder(round);
    nested.unary = x => callUnary(h, callUnary(g, x, 1), 1);
    say("it calls back", callUnary(nested, round, 2));
}
console.log(lines.join("\n"));
