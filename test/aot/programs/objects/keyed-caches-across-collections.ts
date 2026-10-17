// What is remembered about a shape and a key must not outlive either. Shapes are made, asked in every way, dropped and collected, and new ones made with the same names at other places.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun?.gc(true));
function read(object: any, key: any): any { return object[key]; }
function isIn(object: any, key: any): boolean { return key in object; }
function owns(object: any, key: any): boolean { return Object.prototype.hasOwnProperty.call(object, key); }
function hasOwn(object: any, key: any): boolean { return Object.hasOwn(object, key); }
function store(object: any, key: any, value: any): void { object[key] = value; }
function fresh(text: string): string { return ("[" + text + "]").slice(1, -1); }

const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
const mark = Symbol("mark");
let wrong = 0;
let asked = 0;
function expect(what: string, got: any, wanted: any): void {
    asked++;
    if (got !== wanted && wrong++ < 20) console.log("WRONG " + what + ": " + String(got) + ", not " + String(wanted));
}
const parents: any[] = [{ fromParent: "p0" }, { fromParent: "p1", beta: "parent's beta" }, Object.create({ fromGrandparent: "g" })];
function make(round: number, variant: number): [any, Map<any, any>] {
    const parent = parents[variant % parents.length];
    const object: any = variant % 4 === 3 ? {} : Object.create(parent);
    const mirror = new Map<any, any>();
    object["only" + round + "_" + (variant >> 2)] = 0;
    for (let i = 0; i < names.length; i++) {
        const name = names[(i * (1 + variant % 5) + round + variant) % names.length];
        if ((i + variant) % 3 === 0 || mirror.has(name)) continue;
        object[name] = round * 1000 + variant * 10 + i;
        mirror.set(name, object[name]);
    }
    if (variant % 2) { object[mark] = variant; mirror.set(mark, variant); }
    return [object, mirror];
}
function ask(object: any, mirror: Map<any, any>, keys: any[], where: string): void {
    const prototype = Object.getPrototypeOf(object);
    for (const key of keys) {
        const name = typeof key === "string" ? names.find(n => n === key) ?? key : key;
        const own = mirror.has(name);
        expect(where + " read", read(object, key), own ? mirror.get(name) : prototype[name]);
        expect(where + " in", isIn(object, key), own || name in prototype);
        expect(where + " hasOwnProperty", owns(object, key), own);
        expect(where + " hasOwn", hasOwn(object, key), own);
    }
}
const everyKey: any[] = [...names, mark, "fromParent", "fromGrandparent", "toString", "nothing"];
let keep: [any, Map<any, any>][] = [];
for (let round = 0; round < 24; round++) {
    const made: [any, Map<any, any>][] = [];
    for (let variant = 0; variant < 120; variant++) made.push(make(round, variant));
    const cut = everyKey.map(key => typeof key === "string" ? fresh(key) : key);
    for (const [object, mirror] of made) { ask(object, mirror, everyKey, "new"); ask(object, mirror, cut, "new, cut keys"); }
    for (const [object, mirror] of keep) ask(object, mirror, everyKey, "kept");
    for (const [object, mirror] of made) {
        for (const key of ["added", names[round % names.length], mark]) { store(object, key, round); mirror.set(key, round); }
        ask(object, mirror, ["added", ...everyKey], "stored");
    }
    keep = made.filter((_, index) => index % 40 === round % 40).concat(keep.slice(0, 6));
    if (round % 3 !== 2) collect();
    for (const [object, mirror] of keep) ask(object, mirror, cut, "kept over a collection");
}

// An answer that a collection has left alone is still made false by what makes it false.
const base: any = {};
const heir: any = Object.create(base);
heir.own = 1;
expect("absent", read(heir, "arrives"), undefined);
expect("absent in", isIn(heir, "arrives"), false);
collect();
expect("absent after a collection", read(heir, "arrives"), undefined);
base.arrives = "on the prototype";
expect("inherited", read(heir, "arrives"), "on the prototype");
expect("inherited in", isIn(heir, "arrives"), true);
expect("not own", owns(heir, "arrives"), false);
collect();
expect("inherited after a collection", read(heir, "arrives"), "on the prototype");
delete base.arrives;
expect("gone", read(heir, "arrives"), undefined);
expect("gone in", isIn(heir, "arrives"), false);
collect();
Object.defineProperty(base, "arrives", { set(value) { this.caught = value; }, configurable: true });
const other: any = Object.create(base);
other.own = 1;
store(other, "arrives", 5);
expect("a setter that came after a collection", other.caught, 5);
expect("and no own property", owns(other, "arrives"), false);

// A dictionary keeps its shape while its properties come and go.
const table: any = {};
for (let i = 0; i < 150; i++) store(table, "t" + i, i);
for (let turn = 0; turn < 4; turn++) {
    for (let i = 0; i < 150; i++) {
        const there = turn === 0 || i % 2 === 1 || (turn === 3 && i % 4 === 0);
        expect("dictionary read", read(table, "t" + i), there ? i : undefined);
        expect("dictionary in", isIn(table, "t" + i), there);
        expect("dictionary hasOwn", hasOwn(table, "t" + i), there);
    }
    collect();
    if (turn === 0) for (let i = 0; i < 150; i += 2) delete table["t" + i];
    if (turn === 2) for (let i = 0; i < 150; i += 4) store(table, fresh("t" + i), i);
}
console.log("asked " + asked + ", wrong " + wrong);
