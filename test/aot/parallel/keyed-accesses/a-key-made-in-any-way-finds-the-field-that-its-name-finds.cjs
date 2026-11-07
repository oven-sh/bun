// `holder[key]` and `holder[key] = value` where the key names a field that the holder was written with, and the run makes the key in every way it can: written, joined, cut out
// of a longer text, read out of codes, parsed, split, an object that turns into the name, a symbol. Each access is repeated until where the field lies is remembered. The holders
// are also of every standing: a literal, an instance, the prototype of another object, an object below such a prototype, one that was spread or assigned into, one of another realm.
const vm = require("node:vm");
const mark = Symbol("mark");
const shared = Symbol.for("shared");
const long = "....any....count....label....";
function take(holder, key) { return holder[key]; }
function lay(holder, key, value) { holder[key] = value; }
const spellings = {
    written: name => name,
    joined: name => name.slice(0, 1) + name.slice(1),
    joinedTwice: name => "" + name.slice(0, 2) + "" + name.slice(2) + "",
    cut: name => long.substring(long.indexOf(name), long.indexOf(name) + name.length),
    cutOfJoined: name => (".." + name + "..").slice(2, 2 + name.length),
    fromCodes: name => String.fromCharCode(...Array.from(name, letter => letter.charCodeAt(0))),
    parsed: name => JSON.parse('"' + name + '"'),
    split: name => ("a," + name + ",b").split(",")[1],
    template: name => `${name}`,
    turnsIntoName: name => ({ toString() { return name; } }),
    wrapped: name => new String(name),
    listOfOne: name => [name],
};
class Gate { constructor(n) { this.any = n % 2 ? n : "n" + n; this.count = n; this.label = "l" + n; this[mark] = "m" + n; this[shared] = n; } }
const below = [];
const makers = {
    literal: n => ({ any: n % 2 ? n : "n" + n, count: n, label: "l" + n, [mark]: "m" + n, [shared]: n }),
    instance: n => new Gate(n),
    prototypeOfAnother: n => { const above = { any: n % 2 ? n : "n" + n, count: n, label: "l" + n, [mark]: "m" + n, [shared]: n }; below.push(Object.create(above)); return above; },
    belowAnother: n => Object.create({ any: "above" + n, count: -n, label: "above", [mark]: "above", [shared]: -n }),
    belowAnInstance: n => Object.create(new Gate(n)),
    spread: n => ({ ...{ any: n % 2 ? n : "n" + n, count: n }, label: "l" + n, ...{ [mark]: "m" + n, [shared]: n } }),
    assigned: n => Object.assign({ any: 0, count: 0, label: "", [mark]: 0, [shared]: 0 }, { any: n % 2 ? n : "n" + n, count: n, label: "l" + n, [mark]: "m" + n, [shared]: n }),
    ofAnotherRealm: n => Object.assign(vm.runInNewContext("({ any: 0, count: 0, label: '' })"), { any: n, count: n, label: "l" + n, [mark]: "m" + n, [shared]: n }),
};
const values = [0, -0, 1.5, "text", "", undefined, null, true, { inner: 1 }, [2], mark, 10n, function named() {}, NaN];
function tell(value) {
    if (typeof value === "function") return "function:" + value.name;
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return typeof value + ":" + (Object.is(value, -0) ? "-0" : String(value));
}
function tellAll(holder) { return Reflect.ownKeys(holder).map(key => String(key) + "=" + tell(holder[key])).join(","); }
const names = ["any", "count", "label"];
for (const kind in makers) {
    for (const spelling in spellings) {
        const holder = makers[kind](3);
        const other = makers[kind](4);
        let read = 0;
        for (let round = 0; round < 40; round++) {
            for (const name of names) {
                read += tell(take(holder, spellings[spelling](name))).length + tell(take(other, spellings[spelling](name))).length;
                lay(holder, spellings[spelling](name), values[(round + name.length) % values.length]);
                read += tell(take(holder, spellings[spelling](name))).length;
            }
        }
        console.log(kind, spelling, read, "|", tellAll(holder), "|", tellAll(other));
    }
    const holder = makers[kind](5);
    const other = makers[kind](6);
    let read = 0;
    for (let round = 0; round < 40; round++) {
        for (const key of [mark, shared, Symbol.for("sha" + "red")]) {
            read += tell(take(holder, key)).length + tell(take(other, key)).length;
            lay(holder, key, values[round % values.length]);
            read += tell(take(holder, key)).length;
        }
    }
    console.log(kind, "symbols", read, "|", tellAll(holder), "|", tellAll(other));
    delete holder[mark];
    delete holder.any;
    console.log(kind, "gone", "|", tell(take(holder, mark)), tell(take(holder, "a" + "ny")), tell(take(holder, long.substring(4, 7))), tell(take(holder, { toString: () => "any" })));
    lay(holder, mark, "again");
    lay(holder, "an" + "y", "again");
    Object.freeze(other);
    lay(other, shared, "no");
    lay(other, "an" + "y", "no");
    console.log(kind, "symbols behind", "|", tellAll(holder), "|", tellAll(other), "|", tell(take(other, shared)), tell(take(other, "a" + "ny")));
}
console.log(below.length, below.map(object => names.map(name => tell(take(object, "" + name))).join(" ") + " " + tell(take(object, mark)) + " own:" + Reflect.ownKeys(object).length).join(" | "));
for (const object of below) {
    for (let round = 0; round < 40; round++) lay(object, "co" + "unt", round);
    lay(Object.getPrototypeOf(object), "cou" + "nt", "above");
}
console.log(below.map(object => tell(take(object, "count")) + " " + tell(take(Object.getPrototypeOf(object), "count"))).join(" | "));
