// Objects get from 100 to 700 names by key, so many that each keeps a table of its own. Names are read, stored, asked for and deleted by key, among them accessors, read-only names and symbols, on the objects and on objects below them.
const sizes = [100, 127, 128, 129, 130, 200, 254, 255, 256, 257, 400, 700];
const marks = [Symbol("a"), Symbol("b"), Symbol.iterator];
let sum = 0;
const note = v => { const text = typeof v === "symbol" ? v.toString() : typeof v === "function" ? "function" : String(v); for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0; };
const attempt = run => { try { return run(); } catch (error) { return error.constructor.name; } };
function namesFor(size, salt) { const list = []; for (let i = 0; i < size; i++) list.push("k" + ((i * 37 + salt) % 1009).toString(36) + "_" + (i % 7)); return list; }
function storeStrict(o, k, v) { "use strict"; o[k] = v; }
function visit(o, keys) {
    for (let r = 0; r < 3; r++) for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        note(attempt(() => o[k])); note(k in o); note(Object.hasOwn(o, k));
        if (r === 1) { note(attempt(() => storeStrict(o, k, i))); note(attempt(() => o[k])); }
        if (r === 2) { note(attempt(() => { o[k] = (o[k] ?? 0) + 1; })); note(attempt(() => o[k])); }
    }
}
for (const size of sizes) {
    for (const bare of [false, true]) {
        const names = namesFor(size, size), others = namesFor(40, size + 500);
        const o = bare ? Object.create(null) : {};
        for (let i = 0; i < names.length; i++) o[names[i]] = i;
        visit(o, names); visit(o, others.slice(0, 10)); visit(o, marks);
        Object.defineProperty(o, names[3], { get() { return "got"; }, set(v) { this.caught = v; }, configurable: true, enumerable: true });
        Object.defineProperty(o, names[5], { value: "fixed", writable: false, configurable: true, enumerable: true });
        o[marks[0]] = "marked";
        visit(o, names.slice(0, 12)); visit(o, marks);
        for (let i = 0; i < names.length; i += 3) note(delete o[names[i]]);
        visit(o, names.slice(0, 40));
        for (let i = names.length - 1; i >= 0; i -= 3) note(attempt(() => { o[names[i]] = -i; }));
        visit(o, names.slice(-40));
        const below = Object.create(o); below.own = 1;
        visit(below, names.slice(0, 30)); visit(below, ["own", "caught", "toString", "__proto__", "constructor"]);
        note(Object.keys(o).length); note(Object.keys(below).length);
        const kept = names.join(" ").split(" ");
        visit(o, kept.slice(10, 50));
        Object.freeze(o);
        visit(o, names.slice(20, 40)); visit(below, names.slice(20, 40));
        console.log(size, bare, sum, Object.keys(o).length, Reflect.ownKeys(below).length);
    }
}
