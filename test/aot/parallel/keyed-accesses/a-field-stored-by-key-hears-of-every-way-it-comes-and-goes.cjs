// `holder[name] = value` under a name that only the run knows, where the name is a field that the holder was written with and that takes any value.
// The store is repeated until where the field lies is remembered; then the holder changes in every way that a store must hear of.
const names = ["open", "shut", "turn", "rest"];
class Strict { static lay(holder, name, value) { holder[name] = value; } }
const lay = Strict.lay;
function layQuietly(holder, name, value) { holder[name] = value; }

class Gate { constructor() { this.open = undefined; this.shut = undefined; this.turn = undefined; this.rest = undefined; } }
class Door extends Gate { constructor() { super(); this.lock = undefined; } }
const makers = {
    literal: () => ({ open: undefined, shut: undefined, turn: undefined, rest: undefined }),
    otherOrder: () => ({ rest: undefined, turn: undefined, shut: undefined, open: undefined }),
    withoutPrototype: () => ({ __proto__: null, open: undefined, shut: undefined, turn: undefined, rest: undefined }),
    longer: () => ({ first: 1, open: undefined, second: "two", shut: undefined, turn: undefined, third: null, rest: undefined }),
    instance: () => new Gate(),
    derived: () => new Door(),
};
const values = [undefined, null, true, 7, -0, 1.5, 2 ** 40, "text", "", Symbol.for("mark"), 12n, () => 1, function named() {}, [1, 2], { inner: 1 }, new Gate(), /x/, NaN];

function tell(value) {
    if (typeof value === "function") return "function " + value.name;
    if (typeof value === "symbol" || typeof value === "bigint") return typeof value + " " + String(value);
    if (Object.is(value, -0)) return "-0";
    if (value instanceof RegExp) return String(value);
    return typeof value === "object" && value !== null ? value.constructor.name + JSON.stringify(value) : String(value);
}
function show(holder) { return Reflect.ownKeys(holder).map(key => String(key) + "=" + tell(holder[key])).join(" "); }
function attempt(store, holder, name, value) {
    try { store(holder, name, value); return "stored"; } catch (error) { return error.constructor.name; }
}
function warm(holder) {
    for (let round = 0; round < 40; round++) {
        for (const name of names) lay(holder, name, values[(round + name.length) % values.length]);
        for (const name of names) layQuietly(holder, name, values[(round * 3 + name.length) % values.length]);
    }
}

const ways = {
    nothing: holder => {},
    frozen: holder => { Object.freeze(holder); },
    sealed: holder => { Object.seal(holder); },
    closedToMore: holder => { Object.preventExtensions(holder); },
    deleted: holder => { delete holder.shut; },
    deletedTwo: holder => { delete holder.open; delete holder.rest; },
    deletedAndFrozen: holder => { delete holder.turn; Object.freeze(holder); },
    deletedAndClosed: holder => { delete holder.turn; Object.preventExtensions(holder); },
    setter: holder => { Object.defineProperty(holder, "turn", { set(value) { heard.push(tell(value)); }, get() { return "got"; }, configurable: true, enumerable: true }); },
    getterAlone: holder => { Object.defineProperty(holder, "turn", { get() { return "got"; }, configurable: true, enumerable: true }); },
    readOnly: holder => { Object.defineProperty(holder, "shut", { writable: false }); },
    hidden: holder => { Object.defineProperty(holder, "rest", { enumerable: false }); },
    more: holder => { holder.added = 1; },
    setterAbove: holder => { Object.setPrototypeOf(holder, { set open(value) { heard.push("above " + tell(value)); } }); },
    deletedBelowSetter: holder => { Object.setPrototypeOf(holder, { set open(value) { heard.push("above " + tell(value)); } }); delete holder.open; },
};
let heard = [];
for (const kind in makers) {
    for (const way in ways) {
        const holder = makers[kind]();
        const other = makers[kind]();
        warm(holder);
        warm(other);
        heard = [];
        ways[way](holder);
        const said = [];
        for (const name of names) said.push(attempt(lay, holder, name, name + "!"), attempt(layQuietly, holder, name, name.length));
        for (const name of names) lay(other, name, name);
        console.log(kind, way, "|", said.join(" "), "|", show(holder), "|", heard.join(","), "|", show(other));
    }
}

for (const kind in makers) {
    const holder = makers[kind]();
    const seen = [];
    for (let round = 0; round < 3; round++) {
        for (const value of values) {
            for (const name of names) lay(holder, name, value);
            seen.push(names.every(name => Object.is(holder[name], value)) && Object.is(holder.open, value) && Object.is(holder.rest, value) && "shut" in holder);
        }
    }
    console.log(kind, "every kind of value", seen.every(Boolean), show(holder));
}
