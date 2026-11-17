// A key that is joined or cut out of a text, under which an object has nothing, is absent. The object's names are asked by their lengths and first units.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const join = (a, b, c) => a + b + c;
const wide = "—x";
const keys = [];
for (const first of ["Declaration", "Rule", "on", "a", "_", "toS", "1", "has", "é", "—"])
    for (const second of ["-", "Exit-", "", "tring"])
        for (const third of ["color", "left", "", "2", "OwnProperty", "to—", "proto__", "x".repeat(70)])
            keys.push(() => join(first, second, third), () => (wide + join(first, second, third)).slice(2));
function read(object, key) { return object[key]; }
function has(object, key) { return key in object; }
function sweep(name, object, names) {
    for (let round = 0; round < 3; ++round) {
        for (const make of keys) {
            const key = make(), text = JSON.parse(JSON.stringify(key));
            const expected = names(text);
            check(name + " " + text, read(object, key), expected);
            check(name + " in " + text, has(object, make()), expected !== undefined);
        }
    }
}
const ofPrototype = text => Object.prototype[text];
const listeners = {};
for (const event of ["OnceExit", "Rule", "Declaration"]) listeners[event] = event;
const listed = text => text === "OnceExit" || text === "Rule" || text === "Declaration" ? text : ofPrototype(text);
sweep("plain", listeners, listed);
sweep("literal", { Rule: 1, toString: 2 }, text => text === "Rule" ? 1 : text === "toString" ? 2 : ofPrototype(text));
sweep("null", Object.assign(Object.create(null), { on: 3 }), text => text === "on" ? 3 : undefined);
class Holder { constructor() { this.Rule = 4; } on() {} }
const holder = new Holder();
sweep("instance", holder, text => text === "Rule" ? 4 : text === "on" ? Holder.prototype.on : ofPrototype(text));
sweep("array", [7, 8, 9], text => text === "1" ? 8 : text === "12" ? undefined : Array.prototype[text]);
sweep("indexed", { 1: 5, 12: 6 }, text => text === "1" ? 5 : text === "12" ? 6 : ofPrototype(text));
const dictionary = {};
for (let i = 0; i < 300; ++i) dictionary["name" + i] = i;
for (let i = 0; i < 290; ++i) delete dictionary["name" + i];
dictionary.Rule = 5;
sweep("dictionary", dictionary, text => text === "Rule" ? 5 : ofPrototype(text));
sweep("proxy", new Proxy(listeners, { get: (target, key) => key === "on-color" ? 6 : Reflect.get(target, key), has: (target, key) => key === "on-color" || key in target }), text => text === "on-color" ? 6 : listed(text));
sweep("function", sweep, text => Function.prototype[text]);
// What comes later is found.
listeners[join("Declaration", "-", "color")] = 10;
check("own later", read(listeners, join("Decl", "aration", "-color")), 10);
check("other", read(listeners, join("Decl", "aration", "-colon")), undefined);
Object.setPrototypeOf(listeners, { [join("a", "Exit-", "left")]: 14 });
check("prototype later", read(listeners, join("a", "Exi", "t-left")), 14);
check("own still", read(listeners, join("On", "ce", "Exit")), "OnceExit");
const bare = {};
check("__proto__", read(bare, join("__pro", "to", "__")), Object.prototype);
check("__proto__ of null", read(Object.create(null), join("__pro", "to", "__")), undefined);
for (let i = 0; i < 400; ++i) { const made = {}; made["k" + i] = i; check("fresh", read(made, join("k", "", i)), i); check("fresh absent", read(made, join("k", "-", i)), undefined); }
console.log(failures);
