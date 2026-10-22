// Instances of classes that extend Array go through every operation on arrays, in typed and in untyped functions. A class that overrides a method says so in `trace`.
const trace: string[] = [];
function note(what: string): void { trace.push(what); }
class Quiet<T> extends Array<T> {}
class Tagged<T> extends Array<T> { tag = "tagged"; }
class Plainly<T> extends Array<T> { static get [Symbol.species]() { return Array; } }
class Loud<T> extends Array<T> {}
for (const name of ["push", "pop", "shift", "unshift", "slice", "splice", "indexOf", "includes", "join", "at", "concat", "map", "filter", "forEach", "find", "some", "every", "reduce", "reverse", "fill", "sort", "keys", "values", "entries", "toString"]) {
    (Loud.prototype as any)[name] = function (this: unknown, ...given: unknown[]) { note(name); return (Array.prototype as any)[name].apply(this, given); };
}
(Loud.prototype as any).toJSON = function (this: unknown[]) { note("toJSON"); return ["json", this.length]; };
class Walked<T> extends Array<T> {}
(Walked.prototype as any)[Symbol.iterator] = function* (this: unknown[]) { note("iterator"); for (let i = this.length; i--;) yield this[i]; };
class Inherits<T> extends Array<T> {}
(Inherits.prototype as any)[1] = "inherited";
(Inherits.prototype as any)[7] = "far";

type Text = string;
const typedOperations: Record<string, (a: Text[]) => unknown> = {
    read: a => [a[0], a[1], a[2], a[7], a[-1 as number], a.length],
    forIndex: a => { let s = ""; for (let i = 0; i < a.length; i++) s += a[i] + ";"; return s; },
    forOf: a => { let s = ""; for (const x of a) s += x + ";"; return s; },
    spread: a => [...a],
    spreadCall: a => Math.max(...a.map(x => (x ? x.length : -1))),
    destructure: a => { const [x, y, ...rest] = a; return [x, y, rest]; },
    store: a => { a[1] = "stored"; return a; },
    storeAtLength: a => { a[a.length] = "appended"; return [a, a.length]; },
    storeFar: a => { a[9] = "far"; return [a, a.length]; },
    push: a => [a.push("pushed"), a],
    pushTwo: a => [a.push("p", "q"), a],
    pop: a => [a.pop(), a],
    shift: a => [a.shift(), a],
    unshift: a => [a.unshift("first"), a],
    slice: a => { const b = a.slice(1); return [b, b.constructor.name]; },
    splice: a => { const b = a.splice(1, 1, "in"); return [b, b.constructor.name, a]; },
    indexOf: a => [a.indexOf("b"), a.indexOf("zz")],
    includes: a => [a.includes("b"), a.includes(undefined as any)],
    join: a => a.join("-"),
    at: a => [a.at(0), a.at(-1), a.at(1)],
    concat: a => { const b = a.concat(["x"], a); return [b, b.constructor.name]; },
    map: a => { const b = a.map(x => x + "!"); return [b, b.constructor.name]; },
    filter: a => { const b = a.filter(x => x !== "b"); return [b, b.constructor.name]; },
    forEach: a => { let s = ""; a.forEach((x, i) => { s += i + x; }); return s; },
    find: a => a.find(x => x === "c"),
    some: a => a.some(x => x === "c"),
    every: a => a.every(x => typeof x === "string"),
    reduce: a => a.reduce((s, x) => s + x, ">"),
    reverse: a => a.reverse(),
    fill: a => a.fill("f", 1),
    sort: a => a.sort(),
    keys: a => [...a.keys()],
    entries: a => [...a.entries()],
    stringify: a => JSON.stringify(a),
    string: a => String(a),
    template: a => `${a}`,
    isArray: a => [Array.isArray(a), a instanceof Array, a.constructor.name],
    objectKeys: a => Object.keys(a),
    from: a => Array.from(a),
    newSet: a => [...new Set(a)],
    setLength: a => { a.length = 1; return [a, a.length]; },
    freeze: a => { Object.freeze(a); try { a.push("no"); } catch (e) { return [(e as Error).constructor.name, a]; } return a; },
    changedInLoop: a => { let s = ""; for (let i = 0; i < a.length; i++) { s += a[i]; if (!i) Object.setPrototypeOf(a, Loud.prototype); } a.push("after"); return [s, a]; },
    changedInMap: a => a.map((x, i) => { if (!i) (a as any).map = () => "mine"; return x; }),
};
const untypedOperations: Record<string, (a: any) => unknown> = {};
for (const name of Object.keys(typedOperations)) untypedOperations[name] = new Function("f", "return function (a) { return f(a); }")(typedOperations[name]);
const anyOperations: Record<string, (a: any) => unknown> = {
    read: a => [a[0], a[1], a[2], a[7], a.length],
    forIndex: a => { let s = ""; for (let i = 0; i < a.length; i++) s += a[i] + ";"; return s; },
    forOf: a => { let s = ""; for (const x of a) s += x + ";"; return s; },
    spread: a => [...a],
    destructure: a => { const [x, y, ...rest] = a; return [x, y, rest]; },
    store: a => { a[1] = "stored"; return a; },
    storeAtLength: a => { a[a.length] = "appended"; return [a, a.length]; },
    push: a => [a.push("pushed"), a],
    pop: a => [a.pop(), a],
    shift: a => [a.shift(), a],
    slice: a => { const b = a.slice(1); return [b, b.constructor.name]; },
    indexOf: a => [a.indexOf("b"), a.indexOf("zz")],
    includes: a => a.includes("b"),
    join: a => a.join("-"),
    at: a => a.at(-1),
    concat: a => { const b = a.concat(["x"]); return [b, b.constructor.name]; },
    map: a => { const b = a.map((x: any) => x + "!"); return [b, b.constructor.name]; },
    filter: a => { const b = a.filter((x: any) => x !== "b"); return [b, b.constructor.name]; },
    forEach: a => { let s = ""; a.forEach((x: any, i: any) => { s += i + x; }); return s; },
    stringify: a => JSON.stringify(a),
    apply: a => String.prototype.concat.apply("", a),
};
function filled<A extends string[]>(a: A): A { a.push("a"); a.push("b"); a.push("c"); trace.length = 0; return a; }
function withHole<A extends string[]>(a: A): A { a.length = 3; a[0] = "a"; a[2] = "c"; trace.length = 0; return a; }
const makers: Record<string, () => string[]> = {
    array: () => filled([]),
    quiet: () => filled(new Quiet<string>()),
    tagged: () => filled(new Tagged<string>()),
    plainly: () => filled(new Plainly<string>()),
    loud: () => filled(new Loud<string>()),
    walked: () => filled(new Walked<string>()),
    inherits: () => filled(new Inherits<string>()),
    inheritsWithHole: () => withHole(new Inherits<string>()),
    quietWithHole: () => withHole(new Quiet<string>()),
    quietOf: () => Quiet.of("a", "b", "c") as string[],
    quietFrom: () => Quiet.from(["a", "b", "c"]) as string[],
    quietSized: () => { const a = new Quiet<string>(3); a[0] = "a"; a[1] = "b"; a[2] = "c"; return a; },
    quietOfValues: () => new Quiet<string>("a", "b", "c"),
    becameLoud: () => Object.setPrototypeOf(filled([]), Loud.prototype),
    ownPush: () => { const a: any = filled([]); a.push = function (x: string) { note("own push"); return Array.prototype.push.call(this, x); }; return a; },
    emptyQuiet: () => new Quiet<string>(),
};
function show(x: unknown): string {
    try { return JSON.stringify(x, (_, v) => (v === undefined ? "<undefined>" : v)) ?? String(x); } catch (e) { return "cannot be shown: " + (e as Error).message; }
}
function listOf(holder: any): string[] { return holder.list; }
function listOrNothingOf(holder: any): string[] | undefined { return holder.list; }
function asWritten(holder: any): string[] { return holder.list as string[]; }
const heldOperations: Record<string, (a: any) => unknown> = {};
for (const name of Object.keys(typedOperations)) heldOperations[name] = a => typedOperations[name]!(name.length % 3 === 0 ? listOf({ list: a }) : name.length % 3 === 1 ? listOrNothingOf(Object.create({ list: a }))! : asWritten({ get list() { return a; } }));
for (const [family, operations] of Object.entries({ typed: typedOperations, throughUntyped: untypedOperations, readByName: heldOperations, any: anyOperations })) {
    for (const maker of Object.keys(makers)) {
        for (const name of Object.keys(operations)) {
            // for-of and destructuring over a class with an iterator of its own have a program of their own: arrays/array-subclass-with-own-iterator.
            if (maker === "walked" && family !== "any" && (name === "forOf" || name === "destructure")) continue;
            for (let round = 0; round < 2; round++) {
                const a = makers[maker]!();
                trace.length = 0;
                let line: string;
                try { line = show(operations[name]!(a)); } catch (e) { line = "throws " + (e as Error).constructor.name + ": " + (e as Error).message; }
                const said = trace.join(",");
                if (!round) console.log(family, maker, name, line, "{" + said + "}");
            }
        }
    }
}
