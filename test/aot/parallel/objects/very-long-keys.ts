// A key that is a very long string put together of pieces: read, asked for and stored under, on objects that have such a name and on objects that have not.
function read(object: any, key: any): any { return object[key]; }
function isIn(object: any, key: any): boolean { return key in object; }
function owns(object: any, key: any): boolean { return Object.prototype.hasOwnProperty.call(object, key); }
function hasOwn(object: any, key: any): boolean { return Object.hasOwn(object, key); }
function store(object: any, key: any, value: any): void { object[key] = value; }
const chunk = "0123456789abcdef".repeat(40);
// Each call makes a new string of new pieces; `shape` says how they are put together.
function long(seed: string, pieces: number, shape: number): string {
    let text = seed;
    if (shape === 0) for (let i = 0; i < pieces; i++) text = text + chunk;
    else if (shape === 1) for (let i = 0; i < pieces; i++) text = chunk + text;
    else if (shape === 2) { let half = ""; for (let i = 0; i < pieces; i++) half += chunk; text = text + half; }
    else if (shape === 3) { const whole = seed + chunk.repeat(pieces) + "tail"; text = whole.slice(0, whole.length - 4); }
    else if (shape === 4) for (let i = 0; i < pieces; i++) text = glue(text, chunk);
    else if (shape === 5) for (let i = 0; i < pieces; i++) text = glue(chunk, text);
    else { let left: any = seed, right: any = chunk; for (let i = 1; i < pieces; i++) { if (i & 1) left = glue(left, chunk); else right = glue(chunk.slice(0, 100), glue(chunk.slice(100), right)); } text = glue(left, right); }
    return text;
}
// Of two values of which nothing is known: no string is built here, the two are tied together.
function glue(a: any, b: any): any { return a + b; }
function same(seed: string, pieces: number, shape: number): string { return shape === 1 || shape === 5 ? chunk.repeat(pieces) + seed : seed + chunk.repeat(pieces); }
const lines: string[] = [];
const wide = "αβ";
for (const shape of [0, 1, 2, 3, 4, 5, 6]) {
    const small: any = { a: 1, b: 2 };
    const memo: any = {};
    const parent: any = {};
    const child: any = Object.create(parent);
    const withGetter: any = {};
    for (const seed of ["x", "y", wide]) {
        lines.push("shape " + shape + " seed " + seed.length + ": absent " + [read(small, long(seed, 8, shape)), isIn(small, long(seed, 8, shape)), owns(small, long(seed, 8, shape)), hasOwn(small, long(seed, 8, shape))].join());
        store(memo, long(seed, 8, shape), "kept " + seed);
        store(parent, long(seed, 9, shape), "inherited " + seed);
        Object.defineProperty(withGetter, same(seed, 8, shape), { get() { return "got " + seed; }, enumerable: true });
    }
    for (const seed of ["x", "y", "z", wide]) {
        const found = [read(memo, long(seed, 8, shape)), isIn(memo, long(seed, 8, shape)), owns(memo, long(seed, 8, shape)), hasOwn(memo, long(seed, 8, shape)), read(memo, long(seed, 7, shape)), read(memo, same(seed, 8, shape))];
        const above = [read(child, long(seed, 9, shape)), isIn(child, long(seed, 9, shape)), owns(child, long(seed, 9, shape)), hasOwn(child, long(seed, 9, shape)), owns(parent, long(seed, 9, shape))];
        lines.push("shape " + shape + " seed " + seed.length + seed.charCodeAt(0) + ": " + found.join() + " | " + above.join() + " | " + read(withGetter, long(seed, 8, shape)));
    }
    store(memo, long("x", 8, shape), "kept again");
    lines.push("stored over: " + read(memo, same("x", 8, shape)) + ", names " + Object.keys(memo).length + ", lengths " + Object.keys(memo).map(name => name.length).join());
    // The same length, another text, differing at the start, in the middle, at the end.
    const base = same("x", 8, shape);
    for (const at of [0, base.length >> 1, base.length - 1]) {
        const changed = base.slice(0, at) + "#" + base.slice(at + 1);
        lines.push("differs at " + at + ": " + [read(memo, changed), isIn(memo, changed), hasOwn(memo, changed)].join());
    }
}
// Receivers that answer for themselves.
const key = () => long("k", 8, 4);
const trapped = new Proxy({}, { get(_, name) { return "trapped " + String(name).length; }, has(_, name) { return String(name).length > 5000; } });
lines.push("proxy: " + read(trapped, key()) + " " + isIn(trapped, key()));
lines.push("array: " + read([1, 2], key()) + " " + isIn([1, 2], key()) + ", string: " + read("text", key()) + ", bytes: " + read(new Uint8Array(2), key()) + ", function: " + read(function () {}, key()));
class Box { width = 1; }
lines.push("instance: " + read(new Box(), key()) + " " + isIn(new Box(), key()) + " " + hasOwn(new Box(), key()));
const many: any = {};
for (let i = 0; i < 3000; i++) many["m" + i] = i;
store(many, key(), "among many");
lines.push("among many: " + read(many, key()) + " " + read(many, long("j", 8, 4)) + " " + isIn(many, key()) + " " + hasOwn(many, long("j", 8, 6)));
for (const nothing of [null, undefined]) { try { read(nothing, key()); } catch (error) { lines.push("of " + nothing + ": " + (error as Error).constructor.name); } }
console.log(lines.join("\n"));
