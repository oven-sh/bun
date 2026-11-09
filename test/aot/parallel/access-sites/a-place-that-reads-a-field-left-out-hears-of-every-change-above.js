// `request.signal` of an instance of a class whose constructor stores the property on some instances alone: the layout has a slot for it, and this instance leaves it empty.
// What such a read finds stands above the instance: nothing, or a value of an object above the class's prototype. The place remembers it. EVERY WAY IN WHICH THE ANSWER MAY CHANGE ENDS THAT:
// a store, a definition, an accessor on the instance, a store and a removal behind it; a store, a definition, an accessor, a removal above; a store on the class's prototype; another prototype for the instance,
// for the class's prototype, for the object above it; a Proxy laid above the chain.
// EACH PLACE IS WARMED ON ITS OWN: every way has a reader of its own for each of the two beginnings, which is one place, asked 400 times before anything changes.
// EACH HAS A SECOND PLACE THAT IS CROWDED AND NEVER WARM: instances of four other classes come between, so what it reads off an instance goes by the tables behind the places, where an instance that has the property and one that leaves it out are told apart anew.
// The ways run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
class Request { constructor(n, signal) { this.n = n; if (signal !== undefined) this.signal = signal; } }
class First { constructor() { this.signal = "of a first kind"; this.a = 1; } }
class Second { constructor() { this.b = 1; this.signal = "of a second kind"; } }
class Third { constructor() { this.c = 1; this.d = 2; this.signal = "of a third kind"; } }
class Fourth { constructor() { this.e = 1; this.f = 2; this.g = 3; this.signal = "of a fourth kind"; } }
const others = [new First, new Second, new Third, new Fourth];
const crowds = [o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal];
const readers = [o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal];
console.log(new Function("readers", "crowds", "others", "Request", `
    const lines = [];
    let next = 0;
    // What stands above may refuse the constructor's store.
    const filledAnew = n => { try { return new Request(n, "its own too"); } catch (error) { return { signal: "refused: " + error.constructor.name }; } };
    let crowded;
    const throughCrowd = object => { for (const other of others) crowded(other); return crowded(object); };
    const beginnings = [() => ({ signal: "above from the beginning" }), () => ({ })];
    const ways = [
        (one, root) => { one.signal = "stored on the instance"; },
        (one, root) => { Object.defineProperty(one, "signal", { value: "defined on the instance" }); },
        (one, root) => { Object.defineProperty(one, "signal", { get() { return "an accessor on the instance, of " + (this === one); } }); },
        (one, root) => { one.signal = "stored and removed"; delete one.signal; },
        (one, root) => { root.signal = "stored above"; },
        (one, root) => { Object.defineProperty(root, "signal", { value: "defined above" }); },
        (one, root) => { Object.defineProperty(root, "signal", { get() { return "an accessor above, of " + (this === one); } }); },
        (one, root) => { delete root.signal; },
        (one, root) => { Request.prototype.signal = "stored on the prototype of the class"; },
        (one, root) => { Object.defineProperty(Request.prototype, "signal", { configurable: true, get() { return "an accessor on the prototype of the class, of " + (this === one); } }); },
        (one, root) => { Object.setPrototypeOf(one, { signal: "another prototype" }); },
        (one, root) => { Object.setPrototypeOf(Request.prototype, { signal: "another object above the class" }); },
        (one, root) => { Object.setPrototypeOf(root, { signal: "laid above the chain" }); },
        (one, root) => { Object.setPrototypeOf(root, new Proxy({ }, { get(target, key) { return key === "signal" ? "a proxy above" : undefined; } })); },
    ];
    for (const begin of beginnings) {
        for (const way of ways) {
            const root = begin();
            Object.setPrototypeOf(Request.prototype, root);
            crowded = crowds[next];
            const signalOf = readers[next++];
            let seen;
            for (let turn = 0; turn < 400; turn++) seen = signalOf(new Request(turn));
            const one = new Request(1), other = new Request(2), filled = new Request(3, "its own");
            lines.push(seen + " . " + signalOf(filled) + " . " + throughCrowd(filled) + " . " + throughCrowd(one) + " . " + throughCrowd(filled));
            way(one, root);
            lines.push(" > " + signalOf(one) + " | " + signalOf(other) + " | " + signalOf(new Request(4)) + " | " + signalOf(filled) + " | " + signalOf(filledAnew(5)) + " | " + throughCrowd(filled) + " | " + throughCrowd(one) + " | " + throughCrowd(other));
            for (let turn = 0; turn < 400; turn++) seen = signalOf(new Request(turn));
            lines.push(" > " + seen + " | " + signalOf(new Request(6)) + " | " + signalOf(one) + " | " + signalOf(filled));
            delete Request.prototype.signal;
            lines.push(" > " + signalOf(new Request(7)) + " | " + signalOf(one));
        }
    }
    return lines.join("\\n");
`)(readers, crowds, others, Request));
