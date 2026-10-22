// `for await` and `yield*` over async generators whose prototype chain the program has changed: the `prototype` object of the generator function gets a `next`, a `return`,
// an iterator method or a harmless property, is replaced by another object or by a number, and the generator object itself gets another prototype or none.
// `next` is read once, when the loop opens: a change in the middle of a loop is seen by the next loop only.
const lines = [];
function makeCount(label) {
    return async function* (n) {
        try {
            for (let i = 0; i < n; i++) yield label + i;
            return label + " is over";
        } finally {
            lines.push(label + " is closed");
        }
    };
}
async function* other() { yield "from the other"; }
async function collect(title, source, limit = 99) {
    await null;
    const seen = [];
    try {
        for await (const x of source) { seen.push(x); if (seen.length >= limit) break; }
    } catch (error) {
        seen.push("caught " + (error instanceof TypeError ? "TypeError" : error.message));
    }
    lines.push(title + ": " + seen.join(" "));
}
async function* through(source) { yield "returned: " + (yield* source); }

const realNext = Object.getPrototypeOf(makeCount("z").prototype).next;
let calls = 0;
const kinds = [
    ["as made", () => makeCount("a")(2)],
    ["a harmless property on the prototype", () => { const f = makeCount("b"); f.prototype.label = "b"; return f(2); }],
    ["next on the prototype", () => { const f = makeCount("c"); f.prototype.next = () => Promise.resolve({ done: ++calls % 3 === 0, value: "other next " + calls }); return f(2); }],
    ["next on the prototype that calls the real one", () => { const f = makeCount("d"); f.prototype.next = function (value) { lines.push("next is called"); return realNext.call(this, value); }; return f(2); }],
    ["next on the prototype, as a getter", () => { const f = makeCount("e"); Object.defineProperty(f.prototype, "next", { get() { lines.push("next is read"); return realNext; } }); return f(2); }],
    ["an iterator method on the prototype", () => { const f = makeCount("f"); f.prototype[Symbol.asyncIterator] = () => other(); return f(2); }],
    ["an undefined iterator method on the prototype", () => { const f = makeCount("g"); f.prototype[Symbol.asyncIterator] = undefined; return f(2); }],
    ["return on the prototype", () => { const f = makeCount("h"); f.prototype.return = value => { lines.push("other return"); return Promise.resolve({ done: true, value }); }; return f(3); }],
    ["next added after the generator was made", () => { const f = makeCount("i"); const g = f(2); f.prototype.next = () => Promise.resolve({ done: true, value: "late" }); return g; }],
    ["next added and taken away", () => { const f = makeCount("j"); f.prototype.next = () => { throw new Error("never"); }; delete f.prototype.next; return f(2); }],
    ["another object as the prototype", () => { const f = makeCount("k"); f.prototype = Object.create(Object.getPrototypeOf(f.prototype)); return f(2); }],
    ["an object without the methods as the prototype", () => { const f = makeCount("l"); f.prototype = {}; return f(2); }],
    ["a number as the prototype", () => { const f = makeCount("m"); f.prototype = 5; return f(2); }],
    ["the prototype of another generator function", () => { const g = makeCount("n")(2); Object.setPrototypeOf(g, makeCount("o").prototype); return g; }],
    ["a prototype with a next of its own", () => { const g = makeCount("p")(2); Object.setPrototypeOf(g, { __proto__: Object.getPrototypeOf(g), next: () => Promise.resolve({ done: true, value: "never seen" }) }); return g; }],
    ["no prototype", () => Object.setPrototypeOf(makeCount("q")(2), null)],
    ["a frozen prototype", () => { const f = makeCount("r"); Object.freeze(f.prototype); return f(2); }],
];
for (const [title, make] of kinds) {
    await collect(title, make());
    await collect(title + ", broken off", make(), 1);
    await collect(title + ", through yield*", through(make()));
}
{
    const f = makeCount("s");
    const seen = [];
    for await (const x of f(4)) {
        seen.push(x);
        if (x === "s1") f.prototype.next = () => Promise.resolve({ done: true, value: "late next" });
    }
    lines.push("next added in the middle of a loop: " + seen.join(" "));
    await collect("the loop after it", f(4));
}
{
    const g = makeCount("t")(4);
    const seen = [];
    for await (const x of g) {
        seen.push(x);
        if (x === "t1") Object.setPrototypeOf(g, null);
    }
    lines.push("the prototype taken away in the middle of a loop: " + seen.join(" "));
}
console.log(lines.join("\n"));
