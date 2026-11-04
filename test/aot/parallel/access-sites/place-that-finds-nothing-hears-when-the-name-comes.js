// `options.signal` of an object that has no such property: the place remembers that nothing has the name, until something gets it.
// EACH PLACE IS WARMED ON ITS OWN: every step has a reader of its own, which is one place, asked 400 times before anything changes. A reader shared by all steps backs off and is filled no more.
// The steps run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
const root = { };
class Options { constructor(n) { this.n = n; } }
Object.setPrototypeOf(Options.prototype, root);
const readers = [o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n, o => o.signal, o => o.n];
console.log(new Function("readers", "makers", "root", "Options", `
    const lines = [];
    let next = 0;
    const steps = [
        () => { root.signal = "on the root"; },
        () => { delete root.signal; },
        () => { Options.prototype.signal = "on the prototype"; },
        () => { delete Options.prototype.signal; },
        () => { Object.defineProperty(root, "signal", { get() { return "getter on the root"; }, configurable: true }); },
    ];
    for (const make of makers) {
        for (const step of steps) {
            const signalOf = readers[next++], nOf = readers[next++];
            let before;
            for (let turn = 0; turn < 400; turn++) before = signalOf(make(turn)) + " " + nOf(make(turn));
            step();
            lines.push(before + " > " + signalOf(make(1)) + " " + nOf(make(1)));
            for (let turn = 0; turn < 400; turn++) before = signalOf(make(turn)) + " " + nOf(make(turn));
            const one = make(2); one.signal = "own";
            lines.push(before + " " + signalOf(one) + " " + signalOf(make(3)));
        }
        delete root.signal;
    }
    return lines.join("\\n");
`)(readers, [i => new Options(i), i => Object.create(root), i => ({ __proto__: root, n: i })], root, Options));
