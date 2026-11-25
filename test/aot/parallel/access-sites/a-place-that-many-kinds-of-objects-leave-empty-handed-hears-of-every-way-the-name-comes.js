// `options.signal` asked at one place of objects of six kinds, none of which has such a property: the place remembers of each kind that nothing has the name.
// EVERY WAY IN WHICH THE NAME MAY COME TO ONE OF THEM ENDS THAT FOR THAT ONE, and the others go on finding what they should:
// a store, a definition, an accessor on the object, a store behind a removal; a store, a definition, an accessor above, a store behind a removal above; another prototype for the object,
// another object or a Proxy laid above the chain; a store on the prototype of the class; a store above behind the removal of another property; both frozen. The collector runs in between.
// EACH PLACE IS WARMED ON ITS OWN: every way has a reader of its own for each kind that it is tried on, asked 3,000 times in turns by all six kinds before anything changes.
// The ways run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
class Options { constructor(n) { this.n = n; } }
class Settings { constructor(n) { this.m = n; this.n = n; } }
const readers = [o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal];
console.log(new Function("readers", "Options", "Settings", "collect", `
    const lines = [];
    let next = 0;
    const kinds = [
        root => { Object.setPrototypeOf(Options.prototype, root); return i => new Options(i); },
        root => { Object.setPrototypeOf(Settings.prototype, root); return i => new Settings(i); },
        root => i => Object.create(root),
        root => i => ({ __proto__: root, n: i }),
        root => i => { const bare = Object.create(null); bare.n = i; bare.m = i; return bare; },
        root => i => ({ n: i, m: i, l: i }),
    ];
    const ways = [
        (one, root) => { one.signal = "stored on the object"; },
        (one, root) => { Object.defineProperty(one, "signal", { value: "defined on the object" }); },
        (one, root) => { Object.defineProperty(one, "signal", { get() { return "an accessor on the object, of " + (this === one); } }); },
        (one, root) => { one.signal = "stored"; delete one.signal; },
        (one, root) => { one.signal = "stored"; delete one.signal; one.signal = "stored behind a removal"; },
        (one, root) => { root.signal = "stored above"; },
        (one, root) => { Object.defineProperty(root, "signal", { value: "defined above" }); },
        (one, root) => { Object.defineProperty(root, "signal", { get() { return "an accessor above, of " + (this === one); } }); },
        (one, root) => { root.signal = "stored"; delete root.signal; root.signal = "stored above behind a removal"; },
        (one, root) => { Object.setPrototypeOf(one, { signal: "another prototype" }); },
        (one, root) => { Object.setPrototypeOf(root, { signal: "laid above the chain" }); },
        (one, root) => { Object.setPrototypeOf(root, new Proxy({ }, { get(target, key) { return key === "signal" ? "a proxy above" : undefined; } })); },
        (one, root) => { Options.prototype.signal = "stored on the prototype of the class"; },
        (one, root) => { root.a = 1; root.b = 2; delete root.a; root.signal = "stored above behind the removal of another"; },
        (one, root) => { Object.freeze(one); Object.freeze(root); },
    ];
    for (let kind = 0; kind < kinds.length; kind++) {
        for (const way of ways) {
            const root = { };
            const makers = kinds.map(make => make(root));
            const signalOf = readers[next++];
            const all = () => makers.map((make, index) => String(signalOf(make(index)))).join(" ");
            let found = 0;
            for (let turn = 0; turn < 3000; turn++) found += signalOf(makers[turn % makers.length](turn)) === undefined ? 0 : 1;
            const one = makers[kind](1), other = makers[kind](2);
            collect();
            lines.push(found + " . " + all());
            way(one, root);
            lines.push(" > " + signalOf(one) + " | " + signalOf(other) + " | " + all());
            collect();
            for (let turn = 0; turn < 3000; turn++) found += signalOf(makers[turn % makers.length](turn)) === undefined ? 0 : 1;
            lines.push(" > " + found + " | " + signalOf(one) + " | " + signalOf(other) + " | " + all());
            delete Options.prototype.signal;
            lines.push(" > " + signalOf(one) + " | " + all());
        }
    }
    return lines.join("\\n");
`)(readers, Options, Settings, () => Bun.gc(true)));
