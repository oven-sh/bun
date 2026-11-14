// A key that is a short part of a wide string finds the name that a Latin-1 part finds.
// COUNT: operationAOTGetByValGeneric <= 500
const names = ["id", "key", "name", "color", "width1", "opacity", "position", "z-index12", "margin-left", "border-color", "display-inside", "text-decoration", "text-decoratio—", "—é", "été", "ÿÿÿÿÿÿÿÿ", "constructor", "__proto__", "toString", "12", "4294967294", "a—", "abcdefg—", "—abcdefgh", "abcdefghij—klmno", "ÿ".repeat(16), "x".repeat(17)];
const text = names.join(";") + ";—";
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const table = Object.create(null), object = {}, map = { color: 1, width1: 2, "margin-left": 3, été: 4, __proto__: { opacity: 5 } };
class Holder { constructor() { this.color = 1; this.name = 2; } get opacity() { return 7; } }
const holder = new Holder();
for (let i = 0; i < names.length; ++i) if (names[i] !== "__proto__") { table[names[i]] = i; object[names[i]] = i; }
const read = (from, key) => from[key], has = (from, key) => key in from;
const hot = ["color", "opacity", "margin-left", "text-decoration", "été"];
let sum = 0;
for (let round = 0; round < 200; ++round) {
    let start = 0;
    for (let i = 0; i < names.length; ++i) {
        const name = names[i], end = start + name.length, isHot = hot.includes(name);
        if (isHot || round < 4) {
            check("table " + name, table[text.slice(start, end)], name === "__proto__" ? undefined : i);
            check("object " + name, read(object, text.slice(start, end)), name === "__proto__" ? Object.prototype : i);
            if (round < 4) {
                check("map " + name, read(map, text.slice(start, end)), map[name]);
                check("holder " + name, read(holder, text.slice(start, end)), holder[name]);
                check("has " + name, has(table, text.slice(start, end)), name !== "__proto__");
                check("own " + name, Object.hasOwn(map, text.slice(start, end)), Object.hasOwn(map, name));
                const key = text.slice(start, end);
                check("again " + name, read(table, key) === read(object, key) && read(table, key) === read(table, key), name !== "__proto__");
                check("key " + name, key, name);
                const flat = (text.slice(start, end) + "—").slice(0, -1);
                flat.charCodeAt(0);
                check("flat " + name, read(table, flat), name === "__proto__" ? undefined : i);
                const own = {};
                own[text.slice(start, end)] = i;
                check("stored " + name, Object.keys(own).join(), name === "__proto__" ? "" : name);
                check("deleted " + name, delete own[text.slice(start, end)] && Object.keys(own).length, 0);
            }
        }
        start = end + 1;
    }
    if (round === 2 && globalThis.Bun) Bun.gc(true);
}
console.log(failures, names.length);
