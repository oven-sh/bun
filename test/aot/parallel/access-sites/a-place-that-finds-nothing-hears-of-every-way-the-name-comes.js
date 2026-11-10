// `options.signal` of an object that has no such property: the place remembers that nothing has the name. EVERY WAY IN WHICH THE NAME MAY COME ENDS THAT:
// a store on the object, a definition on it, a store, a definition and an accessor on an object above, another prototype for the object, another object or a Proxy laid above the chain.
// EACH PLACE IS WARMED ON ITS OWN: every way has a reader of its own for each kind of object, which is one place, asked 400 times before anything changes.
// The ways run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
class Options { constructor(n) { this.n = n; } }
const readers = [o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal];
console.log(new Function("readers", "Options", `
    const lines = [];
    let next = 0;
    const makers = [
        root => { Object.setPrototypeOf(Options.prototype, root); return i => new Options(i); },
        root => i => Object.create(root),
        root => i => ({ __proto__: root, n: i }),
    ];
    const ways = [
        (one, root) => { one.signal = "stored on the object"; },
        (one, root) => { Object.defineProperty(one, "signal", { value: "defined on the object" }); },
        (one, root) => { root.signal = "stored above"; },
        (one, root) => { Object.defineProperty(root, "signal", { value: "defined above" }); },
        (one, root) => { Object.defineProperty(root, "signal", { get() { return "an accessor above, of " + (this === one); } }); },
        (one, root) => { Object.setPrototypeOf(one, { signal: "another prototype" }); },
        (one, root) => { Object.setPrototypeOf(root, { signal: "laid above the chain" }); },
        (one, root) => { Object.setPrototypeOf(root, new Proxy({ }, { get(target, key) { return key === "signal" ? "a proxy above" : undefined; } })); },
    ];
    for (const maker of makers) {
        for (const way of ways) {
            const root = { };
            const make = maker(root);
            const signalOf = readers[next++];
            let seen;
            for (let turn = 0; turn < 400; turn++) seen = signalOf(make(turn));
            const one = make(1), other = make(2);
            way(one, root);
            lines.push(seen + " > " + signalOf(one) + " | " + signalOf(other) + " | " + signalOf(make(3)));
            for (let turn = 0; turn < 400; turn++) seen = signalOf(make(turn));
            lines.push(seen + " > " + signalOf(make(4)) + " | " + signalOf(one));
        }
    }
    return lines.join("\\n");
`)(readers, Options));
