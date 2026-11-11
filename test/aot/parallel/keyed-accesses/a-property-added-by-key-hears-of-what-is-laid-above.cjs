// `holder[name] = value` adds a property under a name that only the run knows, again and again to fresh holders of one shape, until how the holder changes is remembered.
// Then something is laid above the holders under that name: the next store must find it.
class Strict { static lay(holder, name, value) { holder[name] = value; } }
const lay = Strict.lay;
function layQuietly(holder, name, value) { holder[name] = value; }
function attempt(store, holder, name, value) {
    try { store(holder, name, value); return "stored"; } catch (error) { return error.constructor.name; }
}
class Gate { constructor() { this.first = 1; } }
const kinds = {
    created: above => () => Object.create(above),
    literal: above => () => ({ __proto__: above, first: 1 }),
    instance: above => { Object.setPrototypeOf(Gate.prototype, above); return () => new Gate(); },
    twoUp: above => { const between = Object.create(above); return () => Object.create(between); },
};
const ways = {
    nothing: (above, name) => {},
    setter: (above, name, heard) => { Object.defineProperty(above, name, { set(value) { heard.push(name + "<" + value); }, configurable: true }); },
    getterAlone: (above, name) => { Object.defineProperty(above, name, { get() { return "got"; }, configurable: true }); },
    readOnly: (above, name) => { Object.defineProperty(above, name, { value: "fixed", writable: false, configurable: true }); },
    plainValue: (above, name) => { above[name] = "above"; },
    setterThenGone: (above, name, heard) => { Object.defineProperty(above, name, { set(value) { heard.push(name + "<" + value); }, configurable: true }); delete above[name]; },
};
for (const kind in kinds) {
    for (const way in ways) {
        const above = {};
        const make = kinds[kind](above);
        const names = ["open" + way, "shut" + way];
        for (let round = 0; round < 60; round++) {
            const holder = make();
            for (const name of names) lay(holder, name, round);
            const other = make();
            for (const name of names) layQuietly(other, name, round);
        }
        const heard = [];
        ways[way](above, names[0], heard);
        const said = [];
        for (const store of [lay, layQuietly]) {
            const holder = make();
            for (const name of names) said.push(attempt(store, holder, name, 7));
            said.push(Object.keys(holder).join("+"), String(holder[names[0]]), String(holder[names[1]]));
        }
        console.log(kind, way, "|", said.join(" "), "|", heard.join(","));
    }
}
