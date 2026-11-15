// `to.a = from.b; to.b = from.a; ..`: a row of stores to one object, each fed by a read off another. `to` is only expected to be a Pair (it is read out of a field), `from` is tested at the entry.
// One test of `to` stands in front of the row, and with it the looks whether the slots of `from` are filled, so that the reads between the stores end nothing.
// What is read early has to be what the text reads late. So: `to` IS `from` (each store is seen by the reads behind it) . a slot of `from` is empty (deleted; never laid) . a field of `from` became a getter
// that changes `to` under the row (deletes a field, freezes it, lays a setter, swaps its prototype) . `to` is a literal, a Proxy, frozen, sealed, has setters, fields under attributes, lacks fields, is null . the same in a loop along a chain.
function Pair(a, b, c) { this.a = a; this.b = b; this.c = c; this.other = null; }
function pair(a, b, c) { return new Pair(a, b, c); }
function cross(from) {
    var to = from.other;
    to.a = from.b;
    to.b = from.a;
    to.c = from.a + from.b;
    return to;
}
function copy(from) {
    var to = from.other;
    to.a = from.a;
    to.b = from.b;
    to.c = from.c;
    return to;
}
function shift(from) {
    var to = from.other;
    to.c = from.b;
    to.b = from.a;
    to.a = from.c;
    to.c = from.c + from.a;
    return to.a + "|" + to.b + "|" + to.c;
}
function along(first, turns) {
    var sum = 0;
    for (var from = first; turns > 0; turns--) {
        var to = from.other;
        to.a = from.b;
        to.b = from.a;
        to.c = from.c + 1;
        sum += to.a + to.b + to.c;
        from = to;
    }
    return sum;
}
console.log(new Function("pair", "cross", "shift", "along", "copy", `
    const said = [];
    const show = value => { try { return JSON.stringify(value, (key, held) => key === "other" ? undefined : held); } catch (error) { return error.constructor.name; } };
    const say = (label, make) => {
        for (const run of [cross, shift, copy]) {
            let answer; const from = make();
            try { answer = show(run(from)); } catch (error) { answer = error.constructor.name; }
            said.push(label + " " + run.name + " " + answer + " " + show(from) + " " + show(from && from.other));
        }
    };
    const withOther = (from, other) => { from.other = other; return from; };
    for (let round = 0; round < 3; round++) {
        say("two pairs", () => withOther(pair(1, 2, 3), pair(4, 5, 6)));
        say("one and the same", () => { const one = pair(1, 2, 3); return withOther(one, one); });
        say("a deleted", () => { const from = withOther(pair(1, 2, 3), pair(4, 5, 6)); delete from.a; return from; });
        say("b deleted, found above", () => { const from = withOther(pair(1, 2, 3), pair(4, 5, 6)); delete from.b; Object.setPrototypeOf(from, { b: 20 }); return from; });
        say("the same, a deleted", () => { const one = pair(1, 2, 3); delete one.a; return withOther(one, one); });
        say("a getter deletes", () => { const from = withOther(pair(1, 2, 3), pair(4, 5, 6)); Object.defineProperty(from, "a", { get() { delete from.other.c; return 7; } }); return from; });
        say("a getter freezes", () => { const from = withOther(pair(1, 2, 3), pair(4, 5, 6)); Object.defineProperty(from, "b", { get() { Object.freeze(from.other); return 8; } }); return from; });
        say("a getter lays a setter", () => { const from = withOther(pair(1, 2, 3), pair(4, 5, 6)); Object.defineProperty(from, "a", { get() { Object.defineProperty(from.other, "c", { set(value) { from.other.seen = value; }, configurable: true }); return 9; } }); return from; });
        say("a getter stores", () => { const from = withOther(pair(1, 2, 3), pair(4, 5, 6)); Object.defineProperty(from, "b", { get() { from.c = 100; from.other.a = 200; return 10; } }); return from; });
        say("to a literal", () => withOther(pair(1, 2, 3), { c: 0, b: 0, a: 0 }));
        say("to an empty literal", () => withOther(pair(1, 2, 3), { }));
        say("to a proxy", () => withOther(pair(1, 2, 3), new Proxy(pair(4, 5, 6), { set(target, name, value) { target[name] = value + 1000; return true; } })));
        say("to a frozen pair", () => withOther(pair(1, 2, 3), Object.freeze(pair(4, 5, 6))));
        say("to a pair with a setter", () => { const to = pair(4, 5, 6); Object.defineProperty(to, "b", { set(value) { this.a = value * 2; }, get() { return -1; } }); return withOther(pair(1, 2, 3), to); });
        say("to a pair whose b is read-only", () => withOther(pair(1, 2, 3), Object.defineProperty(pair(4, 5, 6), "b", { value: 50, writable: false })));
        say("to a pair whose b is hidden", () => withOther(pair(1, 2, 3), Object.defineProperty(pair(4, 5, 6), "b", { value: 50, enumerable: false })));
        say("to a sealed pair", () => withOther(pair(1, 2, 3), Object.seal(pair(4, 5, 6))));
        say("from a pair whose a is hidden", () => withOther(Object.defineProperty(pair(1, 2, 3), "a", { value: 10, enumerable: false }), pair(4, 5, 6)));
        say("from a pair whose b is read-only", () => withOther(Object.defineProperty(pair(1, 2, 3), "b", { value: 20, writable: false }), pair(4, 5, 6)));
        say("the same, b read-only", () => { const one = Object.defineProperty(pair(1, 2, 3), "b", { value: 20, writable: false }); return withOther(one, one); });
        say("to a pair without c", () => { const to = pair(4, 5, 6); delete to.c; return withOther(pair(1, 2, 3), to); });
        say("to what stands below a pair", () => withOther(pair(1, 2, 3), Object.create(pair(4, 5, 6))));
        say("to null", () => pair(1, 2, 3));
        say("to a number", () => withOther(pair(1, 2, 3), 5));
        say("from a literal", () => ({ a: 1, b: 2, c: 3, other: pair(4, 5, 6) }));
        say("texts", () => withOther(pair("x", "y", "z"), pair(4, 5, 6)));
        say("doubles", () => withOther(pair(0.5, 1.5, 2.5), pair(4, 5, 6)));
        const ring = [pair(1, 2, 3), pair(4, 5, 6), pair(7, 8, 9)];
        ring.forEach((one, place) => { one.other = ring[(place + 1) % 3]; });
        said.push("a ring " + along(ring[0], 7) + " " + ring.map(show).join(" "));
        const self = pair(1, 2, 3); self.other = self;
        said.push("a ring of one " + along(self, 5) + " " + show(self));
        const broken = [pair(1, 2, 3), pair(4, 5, 6)]; broken[0].other = broken[1]; broken[1].other = { a: 0, b: 0, c: 0, other: broken[0] };
        said.push("a ring with a literal " + along(broken[0], 8) + " " + broken.map(show).join(" "));
    }
    return said.join("\\n");
`)(pair, cross, shift, along, copy));
