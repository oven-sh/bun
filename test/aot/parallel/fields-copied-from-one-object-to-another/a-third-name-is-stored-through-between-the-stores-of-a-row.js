// A row of stores to one object, each fed by a read off another, as in fields-are-copied-from-one-object-to-another-that-may-be-the-same.js; here something stands between the stores.
// three(): a THIRD name is stored through between them; it may be the source, the target, an object of its own, or null (then the first store has run when the TypeError comes).
// late(): the source is read off the target, and is null, or has lost a field, when the first store has run. plain(): the row alone, for targets and sources that have lost a field or had one changed:
// the order of the keys shows a store that took an emptied slot for a filled one.
function Pair(a, b, c) { this.a = a; this.b = b; this.c = c; this.other = null; }
function pair(a, b, c) { return new Pair(a, b, c); }
function plain(from) {
    var to = from.other;
    to.a = from.a;
    to.b = from.b;
    to.c = from.c;
    return to;
}
function three(from) {
    var to = from.other, third = to.other;
    to.a = from.a;
    third.b = 70;
    to.b = from.b;
    third.c = 80;
    to.c = from.c;
    return to;
}
function late(from) {
    var to = from.other, source = to.other;
    to.a = 1;
    to.b = source.b;
    to.c = source.c;
    return to;
}
console.log(new Function("pair", "plain", "three", "late", `
    const said = [];
    const show = value => { try { return JSON.stringify(value, (key, held) => key === "other" ? undefined : held); } catch (error) { return error.constructor.name; } };
    const linked = (from, to, third) => { from.other = to; if (third !== undefined) to.other = third; return from; };
    const without = (one, name) => { delete one[name]; return one; };
    const say = (label, make) => {
        for (const run of [plain, three, late]) {
            let answer; const from = make();
            try { answer = show(run(from)); } catch (error) { answer = error.constructor.name; }
            said.push(label + " " + run.name + " " + answer + " " + show(from) + " " + show(from.other) + " " + show(from.other && from.other.other));
        }
    };
    for (let round = 0; round < 3; round++) {
        say("no third", () => linked(pair(1, 2, 3), pair(4, 5, 6)));
        say("a third of its own", () => linked(pair(1, 2, 3), pair(4, 5, 6), pair(7, 8, 9)));
        say("the third is the source", () => { const from = pair(1, 2, 3); return linked(from, pair(4, 5, 6), from); });
        say("the third is the target", () => { const to = pair(4, 5, 6); return linked(pair(1, 2, 3), to, to); });
        say("all three are one", () => { const one = pair(1, 2, 3); return linked(one, one, one); });
        say("the target lost b", () => linked(pair(1, 2, 3), without(pair(4, 5, 6), "b"), pair(7, 8, 9)));
        say("the target lost a and c", () => linked(pair(1, 2, 3), without(without(pair(4, 5, 6), "a"), "c"), pair(7, 8, 9)));
        say("the source lost c", () => linked(without(pair(1, 2, 3), "c"), pair(4, 5, 6), pair(7, 8, 9)));
        say("the source lost b, found above", () => linked(Object.setPrototypeOf(without(pair(1, 2, 3), "b"), { b: 20 }), pair(4, 5, 6), pair(7, 8, 9)));
        say("the third lost b", () => linked(pair(1, 2, 3), pair(4, 5, 6), without(pair(7, 8, 9), "b")));
        say("the third lost c and is the source", () => { const from = without(pair(1, 2, 3), "c"); return linked(from, pair(4, 5, 6), from); });
        say("the third's b is a setter that stores to the source", () => { const from = pair(1, 2, 3); return linked(from, pair(4, 5, 6), Object.defineProperty(pair(7, 8, 9), "b", { set(value) { from.b = value; from.c = value + 1; } })); });
        say("the third's b is a setter that takes c from the target", () => { const to = pair(4, 5, 6); return linked(pair(1, 2, 3), to, Object.defineProperty(pair(7, 8, 9), "b", { set(value) { delete to.c; } })); });
        say("the target's b is read-only", () => linked(pair(1, 2, 3), Object.defineProperty(pair(4, 5, 6), "b", { value: 50, writable: false }), pair(7, 8, 9)));
        say("the source's c is a getter", () => linked(Object.defineProperty(pair(1, 2, 3), "c", { get() { return 30; }, enumerable: true }), pair(4, 5, 6), pair(7, 8, 9)));
        say("the third is a literal", () => linked(pair(1, 2, 3), pair(4, 5, 6), { c: 0 }));
        say("the third is a number", () => linked(pair(1, 2, 3), pair(4, 5, 6), 5));
    }
    return said.join("\\n");
`)(pair, plain, three, late));
