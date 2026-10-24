// Four fields that the constructor leaves out are created later, each by its own store at its own place in the code, through receivers of which nothing is known: in every one of the 24 orders, over and over,
// with extra properties that came before, between or not at all, in objects that are closed, sealed or frozen half way, with a field deleted and created again, under a key as well as under a name.
// Whatever a place remembers of the object it saw last, the keys come out in the order in which they were created.
const hide = (0, eval)("(value) => value");
class Late {
    constructor(early) { this.early = early; if (hide(false)) { this.a = 0; this.b = 0; this.c = 0; this.d = 0; } }
}
const stores = {
    a: (o, v) => { o.a = v; },
    b: (o, v) => { o.b = v; },
    c: (o, v) => { o.c = v; },
    d: (o, v) => { o.d = v; },
};
function storeUnderKey(o, key, v) { o[key] = v; }
function addExtra(o, name, v) { o[name] = v; }
const orders = [];
(function permute(rest, taken) {
    if (!rest.length) { orders.push(taken); return; }
    for (let i = 0; i < rest.length; i++) permute(rest.slice(0, i).concat(rest.slice(i + 1)), taken.concat(rest[i]));
})(["a", "b", "c", "d"], []);
const seen = new Map();
function note(what, expected, made) {
    const got = Object.keys(made).join() + "|" + Object.values(made).join();
    const line = what + (got === expected ? " right" : " WRONG: " + got + " for " + expected);
    seen.set(line, (seen.get(line) ?? 0) + 1);
}
function attempt(store) {
    try { store(); return true; } catch { return false; }
}
for (let round = 0; round < 60; round++) {
    for (const order of orders) {
        // As it comes.
        let made = hide(new Late(round));
        order.forEach((name, i) => stores[name](made, i));
        note("plain", "early," + order.join() + "|" + round + ",0,1,2,3", made);
        // Under a key.
        made = hide(new Late(round));
        order.forEach((name, i) => storeUnderKey(made, hide(name), i));
        note("keyed", "early," + order.join() + "|" + round + ",0,1,2,3", made);
        // An extra property first, one in the middle.
        made = hide(new Late(round));
        addExtra(made, "x" + (round & 1), "x");
        stores[order[0]](made, 0);
        stores[order[1]](made, 1);
        addExtra(made, "y", "y");
        stores[order[2]](made, 2);
        stores[order[3]](made, 3);
        note("extras", ["early", "x" + (round & 1), order[0], order[1], "y", order[2], order[3]].join() + "|" + [round, "x", 0, 1, "y", 2, 3].join(), made);
        // Closed half way: in strict code the other two stores throw, and nothing is created.
        for (const [what, close] of [["closed", Object.preventExtensions], ["sealed", Object.seal], ["frozen", Object.freeze]]) {
            made = hide(new Late(round));
            stores[order[0]](made, 0);
            stores[order[1]](made, 1);
            close(made);
            const third = attempt(() => { "use strict"; stores[order[2]](made, 2); });
            const again = attempt(() => { "use strict"; stores[order[0]](made, 9); });
            note(what + " " + third + " " + again, "early," + order[0] + "," + order[1] + "|" + round + "," + (what === "frozen" ? 0 : 9) + ",1", made);
        }
        // Deleted and created again: it goes to the end.
        made = hide(new Late(round));
        order.forEach((name, i) => stores[name](made, i));
        delete made[order[1]];
        stores[order[1]](made, 7);
        note("again", ["early", order[0], order[2], order[3], order[1]].join() + "|" + [round, 0, 2, 3, 7].join(), made);
        // Stored twice at the same place.
        made = hide(new Late(round));
        order.forEach((name, i) => { stores[name](made, i); stores[name](made, i + 10); });
        note("twice", "early," + order.join() + "|" + round + ",10,11,12,13", made);
    }
    if (round === 30 && typeof Bun !== "undefined") Bun.gc(true);
}
// A setter comes above, and goes.
Object.defineProperty(Late.prototype, "b", { set(v) { this.early = "set " + v; }, configurable: true });
for (let round = 0; round < 20; round++) {
    const made = hide(new Late(round));
    ["a", "b", "c"].forEach((name, i) => stores[name](made, i));
    note("a setter above", "early,a,c|set 1,0,2", made);
}
delete Late.prototype.b;
for (let round = 0; round < 20; round++) {
    const made = hide(new Late(round));
    ["a", "b", "c"].forEach((name, i) => stores[name](made, i));
    note("and gone", "early,a,b,c|" + round + ",0,1,2", made);
}
for (const line of [...seen.keys()].sort()) console.log(line, seen.get(line));
