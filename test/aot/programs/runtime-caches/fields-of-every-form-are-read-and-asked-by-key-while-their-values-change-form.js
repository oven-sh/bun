// Objects whose names are all known when they are made keep their values in slots of many forms. Each is read and asked by the same key values again and again, while stores by name change the form of a value, take it away and bring it back, and while the objects above gain and lose the names.
const names = ["count", "ratio", "flag", "label", "child", "maybe", "none", "missing", "later"];
const kept = "count ratio flag label child maybe none missing later".split(" ");
const above = { inherited: "from above" };
class Row {
    constructor(i) { this.count = i; this.ratio = i + 0.5; this.flag = (i & 1) === 0; this.label = "row" + i; this.child = { i }; this.maybe = i & 1 ? i : undefined; this.none = null; }
}
const makers = {
    literal: i => ({ count: i, ratio: i + 0.5, flag: (i & 1) === 0, label: "row" + i, child: { i }, maybe: i & 1 ? i : undefined, none: null }),
    instance: i => new Row(i),
    below: i => Object.setPrototypeOf({ count: i, ratio: i / 4, flag: true, label: "b", child: null, maybe: undefined, none: null }, above),
    small: i => ({ count: i & 7, flag: false }),
};
const values = [0, 7, -1, 200, -200, 70000, 2147483647, -2147483648, 2147483648, 0.5, -0, NaN, Infinity, 1e300, true, false, null, undefined, "text", "", Symbol.for("s"), 10n, { a: 1 }, [1], () => 1];
const show = v => typeof v === "function" ? "function" : typeof v === "symbol" ? v.toString() : typeof v === "bigint" ? v + "n" : typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v);
function read(o, k) { return o[k]; }
function has(o, k) { return k in o; }
function own(o, k) { return Object.hasOwn(o, k); }
function ask(o, keys) {
    const line = [];
    for (let turn = 0; turn < 3; turn++)
        for (const k of keys) line.push(show(read(o, k)) + (has(o, k) ? "+" : "-") + (own(o, k) ? "+" : "-"));
    return line.slice(-keys.length).join(" ") + (line.slice(0, keys.length).join(" ") === line.slice(-keys.length).join(" ") ? "" : " MOVED");
}
const out = [];
for (const [kind, make] of Object.entries(makers)) {
    for (const keys of [names, kept]) {
        const objects = [make(1), make(2), make(3)];
        for (const o of objects) out.push(kind + ": " + ask(o, keys));
        for (const name of ["count", "ratio", "flag", "label", "child", "maybe", "none"]) {
            const o = make(4);
            ask(o, keys);
            const line = [];
            for (const v of values) { o[name] = v; line.push(show(read(o, keys[names.indexOf(name)])) + (has(o, keys[names.indexOf(name)]) ? "+" : "-")); }
            out.push(kind + "." + name + ": " + line.join(" "));
            delete o[name];
            out.push(kind + "." + name + " deleted: " + ask(o, keys));
            o[name] = "back";
            out.push(kind + "." + name + " back: " + ask(o, keys));
            Object.defineProperty(o, name, { get() { return "got " + name; }, configurable: true });
            out.push(kind + "." + name + " getter: " + ask(o, keys));
            Object.defineProperty(o, name, { value: 5, writable: false, enumerable: false, configurable: true });
            out.push(kind + "." + name + " fixed: " + ask(o, keys));
        }
        // What is found nowhere is found as soon as an object above has it, and no longer when that gives it up.
        const o = make(5);
        out.push(kind + " before: " + ask(o, keys));
        const holder = Object.getPrototypeOf(o) === Object.prototype ? Object.setPrototypeOf(o, { fresh: 1 }) && Object.getPrototypeOf(o) : Object.getPrototypeOf(o);
        out.push(kind + " below its holder: " + ask(o, keys));
        holder.missing = "on the holder";
        out.push(kind + " above has it: " + ask(o, keys));
        delete holder.missing;
        out.push(kind + " above lost it: " + ask(o, keys));
        Object.defineProperty(holder, "missing", { get() { return "got above"; }, configurable: true });
        out.push(kind + " above has a getter: " + ask(o, keys));
        delete holder.missing;
        out.push(kind + " above lost the getter: " + ask(o, keys));
        above.later = "on the object above";
        out.push(kind + " nearer above: " + ask(o, keys));
        delete above.later;
        o.later = 1;
        out.push(kind + " own: " + ask(o, keys));
        Object.freeze(o);
        out.push(kind + " frozen: " + ask(o, keys));
    }
}
console.log(out.join("\n"));
