const log = [];
const values = JSON.parse('[1, -0, 0.5, 1e21, 1e-7, true, false, null, "", "x", "12", [1, 2], [], {"a": 1}]');
values.push(undefined, NaN, -Infinity, 10n, -0, new Date(0),
    { valueOf() { log.push("valueOf"); return 7; }, toString() { log.push("toString"); return "text"; } },
    { valueOf() { log.push("valueOf gives an object"); return {}; }, toString() { log.push("toString behind it"); return "second"; } },
    { [Symbol.toPrimitive](hint) { log.push("hint " + hint); return hint; } },
    Object.assign(Object.create(null), { toString: () => "bare" }),
    new String("wrapped"), new Number(3), function named() {}, /re/g);
function under(table, value) { const key = value + ":"; table[key] ??= 0; table[key]++; return key; }
function behind(table, value) { const key = "k" + value; table[key] = (table[key] ?? 0) + 1; return key; }
function read(table, value) { return table[value + ":"]; }
const first = {}, second = {};
for (let turn = 0; turn < 40; turn++) for (const value of values) { under(first, value); behind(second, value); }
console.log(JSON.stringify(first));
console.log(JSON.stringify(second));
console.log(values.map(value => read(first, value)).join(" "), log.length, log.slice(0, 12).join(" | "));
for (const value of [Symbol("s"), Symbol.iterator, { valueOf() { return Symbol("inside"); } }, { [Symbol.toPrimitive]() { return {}; } }, Object.create(null), { valueOf() { throw new RangeError("mine"); } }]) {
    for (const run of [under, behind, read]) {
        try { console.log("no throw", String(run({}, value))); } catch (error) { console.log(run.name, error.constructor.name, error.message); }
    }
}
