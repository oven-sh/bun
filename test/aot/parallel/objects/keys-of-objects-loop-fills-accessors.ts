// Objects that a loop fills with accessors: the program reads some of the names, so those have fields; the rest lie beside them. Every way to list the keys has to give the order in which they were defined.
const lines: string[] = [];
function text(key: string | symbol): string { return typeof key === "symbol" ? key.toString() : key; }
function listed(o: any): string {
    const inLoop: string[] = []; for (const key in o) inLoop.push(key);
    const spread = Object.keys({ ...o }), assigned = Object.keys(Object.assign({}, o));
    const all = [Object.keys(o).join(), inLoop.join(), Reflect.ownKeys(o).map(text).join(), Object.getOwnPropertyNames(o).join(), Object.entries(o).map(pair => pair[0]).join(), Object.keys(JSON.parse(JSON.stringify(o))).join(), spread.join(), assigned.join()];
    return all.map(one => one.length > 90 ? one.length + ":" + one.slice(0, 40) + ".." + one.slice(-40) : one).join(" | ");
}
function show(name: string, o: any) { lines.push(name + ": " + listed(o)); }
let reads = 0;
function getterFor(key: string | symbol): () => unknown { return () => { reads++; return text(key).length; }; }
// One form for every name that a loop defines, so that the compiler can tell what the names will be: accessors that are enumerable and configurable.
function more(made: any, names: (string | symbol)[]): any {
    for (const name of names) Object.defineProperty(made, name, { get: getterFor(name), enumerable: true, configurable: true });
    return made;
}
function make(prototype: object | null, names: (string | symbol)[]): any { return more(Object.create(prototype), names); }
// The names that the program reads: ALPHA, BRAVO, CHARLIE, DELTA, ECHO have fields in what make() makes.
function readFields(o: any) { return [o.ALPHA, o.BRAVO, o.CHARLIE, o.DELTA, o.ECHO].join(); }
const mark = Symbol("mark"), other = Symbol("other");

show("fields alone", make(null, ["ALPHA", "BRAVO", "CHARLIE"]));
show("against the order of the fields", make(null, ["ECHO", "ALPHA", "DELTA", "BRAVO"]));
show("in between", make(null, ["x1", "ALPHA", "x2", "x3", "BRAVO", "x4", "CHARLIE", "x5"]));
show("the others first", make(null, ["x1", "x2", "x3", "ALPHA"]));
show("the others last", make(null, ["ALPHA", "x1", "x2"]));
show("a symbol in between", make(null, ["x1", mark, "ALPHA", "x2", other, "BRAVO", "x3"]));
show("a symbol first", make(null, [mark, "ALPHA", "x1", "BRAVO"]));
show("indices in between", make(null, ["x1", "7", "ALPHA", "3", "x2", "BRAVO", "0"]));

const hidden = make(null, ["x1", "ALPHA"]); Object.defineProperty(hidden, "h1", { get: getterFor("h1"), enumerable: false, configurable: true }); more(hidden, ["BRAVO", "x2", "CHARLIE"]);
show("one that is not enumerable in between", hidden);
const hiddenFirst = make(null, []); Object.defineProperty(hiddenFirst, "h1", { get: getterFor("h1"), enumerable: false, configurable: true }); more(hiddenFirst, ["x1", "ALPHA", "x2", "BRAVO"]);
show("one that is not enumerable first", hiddenFirst);
const values = make(null, ["x1", "ALPHA"]); Object.defineProperty(values, "v1", { value: "v1", enumerable: true, configurable: true, writable: true }); more(values, ["BRAVO"]); values.plain = 1; more(values, ["CHARLIE"]);
show("values in between", values);

const deleted = make(null, ["x1", "x2", "ALPHA", "x3"]); delete deleted.x2; more(deleted, ["BRAVO", "x4", "CHARLIE", "x2", "DELTA"]);
show("one of the others deleted", deleted);
const deletedLast = make(null, ["x1", "ALPHA", "x2"]); delete deletedLast.x2; more(deletedLast, ["BRAVO", "x2", "CHARLIE"]);
show("the last of the others deleted and defined again", deletedLast);
const deletedField = make(null, ["x1", "ALPHA", "x2", "BRAVO"]); delete deletedField.ALPHA; more(deletedField, ["x3", "ALPHA", "CHARLIE"]);
show("a field deleted and defined again", deletedField);

// A pair that the slot turns away lies beside the slots under the name of a field.
const movedOut = make(null, ["x1", "ALPHA", "x2"]);
Object.defineProperty(movedOut, "BRAVO", { get: (function (this: unknown) { return "bound"; }).bind(null), enumerable: true, configurable: true });
more(movedOut, ["x3", "CHARLIE", "x4", "DELTA"]);
show("a field outside its slot", movedOut);
const pinned = make(null, ["x1", "ALPHA", "x2", "BRAVO"]);
Object.defineProperty(pinned, "ALPHA", { value: "pinned", enumerable: true, configurable: true }); more(pinned, ["x3", "CHARLIE"]);
show("a field redefined as a value", pinned);
const setterFirst = make(null, ["x1"]);
Object.defineProperty(setterFirst, "ALPHA", { set(_value: unknown) {}, enumerable: true, configurable: true }); more(setterFirst, ["x2", "BRAVO"]);
show("a setter alone under the name of a field", setterFirst);

function many(count: number, every: number, fields: string[]): string[] {
    const names: string[] = []; let next = 0;
    for (let i = 0; i < count; i++) { names.push("n" + i); if (i % every === every - 1 && next < fields.length) names.push(fields[next++]!); }
    return names;
}
const five = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO"];
for (const [count, every] of [[60, 12], [70, 14], [130, 26], [600, 120], [5000, 1000]] as const) {
    const big = make(null, many(count, every, five));
    show(count + " others", big); lines.push("  reads " + readFields(big));
}
const bigWithSymbol = make(null, [...many(200, 40, five.slice(0, 2)), mark, ...many(200, 40, five.slice(2)).map(name => name.startsWith("n") ? "m" + name : name)]);
show("400 others and a symbol", bigWithSymbol);
const under = make({ inherited: 1, ALPHA: "hidden" }, ["x1", "ALPHA", "x2", "BRAVO"]);
show("under a prototype", under);
const frozen = Object.freeze(make(null, ["x1", "ALPHA", "x2", "BRAVO"])); show("frozen", frozen);
const twice = [make(null, ["x1", "ALPHA", "x2", "BRAVO"]), make(null, ["x1", "ALPHA", "x2", "BRAVO"]), make(null, ["x1", "x2", "ALPHA", "BRAVO"])];
twice.forEach((one, index) => show("the same way again " + index, one));

// More of the others than one entry of an order counts.
const huge = make(null, many(66000, 33000, five.slice(0, 2)));
more(huge, ["tail1", "CHARLIE", "tail2", "DELTA"]);
const hugeKeys = Object.keys(huge);
lines.push("66000 others: " + [hugeKeys.length, hugeKeys.indexOf("ALPHA"), hugeKeys.indexOf("BRAVO"), hugeKeys.indexOf("CHARLIE"), hugeKeys.indexOf("DELTA"), hugeKeys.indexOf("tail1"), hugeKeys.indexOf("tail2"), hugeKeys[32999], hugeKeys[33001], hugeKeys[hugeKeys.length - 1]].join());
lines.push("reads " + readFields(huge) + " " + reads);
console.log(lines.join("\n"));
