// What libraries keep on the global object under a registered symbol (globalThis[Symbol.for("some.api.1")]) and read at every call: there, not there, stored over, deleted, put back,
// made an accessor, made read-only; on a global object that has been given and has lost many other properties meanwhile; and the same on an ordinary object that became a dictionary.
const lines = [];
const api = Symbol.for("example.api.1");
const other = Symbol.for("example.other");
const local = Symbol("local");
function read(holder, key) { return holder[key]; }
function has(holder, key) { return key in holder; }
function part(key, name) { return globalThis[key]?.[name]; }
function show(x) { return typeof x === "object" && x ? JSON.stringify(x) : String(x); }
function look(tag, holder) {
    let row = tag;
    for (let round = 0; round < 3; round++)
        row += " " + show(read(holder, api)) + "," + show(read(holder, other)) + "," + show(read(holder, local)) + "," + has(holder, api) + "," + has(holder, other);
    lines.push(row);
}
function exercise(name, holder) {
    look(name + " empty", holder);
    holder[api] = { version: 1 };
    look(name + " set", holder);
    for (let i = 0; i < 80; i++) holder["filler" + name + i] = i;
    look(name + " filled", holder);
    for (let i = 0; i < 80; i += 2) delete holder["filler" + name + i];
    look(name + " thinned", holder);
    holder[api] = { version: 2 };
    holder[local] = "mine";
    look(name + " stored over", holder);
    delete holder[api];
    look(name + " deleted", holder);
    holder[other] = "takes the free place";
    look(name + " another", holder);
    holder[api] = { version: 3 };
    look(name + " put back", holder);
    let reads = 0;
    Object.defineProperty(holder, api, { get() { return "got " + ++reads; }, configurable: true });
    look(name + " accessor", holder);
    Object.defineProperty(holder, api, { value: "fixed", writable: false, configurable: true });
    look(name + " read-only", holder);
    delete holder[api]; delete holder[other]; delete holder[local];
    for (let i = 1; i < 80; i += 2) delete holder["filler" + name + i];
    look(name + " cleared", holder);
}
exercise("global", globalThis);
exercise("plain", {});
exercise("bare", Object.create(null));
exercise("heir", Object.create({ [other]: "inherited" }));
globalThis[api] = { context: "c", trace: "t" };
let joined = "";
for (let i = 0; i < 50; i++) joined = part(api, "context") + part(api, "trace") + part(api, "nothing") + part(other, "context");
lines.push(joined);
delete globalThis[api];
lines.push(String(part(api, "context")));
console.log(lines.join("\n"));
