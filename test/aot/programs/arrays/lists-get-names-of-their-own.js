// Arrays of every kind get a first name of their own, again and again so that whatever remembers has remembered, and go on being arrays: their elements, their length and what is pushed later stay right.
"use strict";
const lines = [];
function mark(list, value) {
    list.pos = value;
    return list;
}
function markFour(list, value) {
    list.pos = value;
    list.end = value + 1;
    list.flag = (value & 1) === 0;
    list.kept = { value };
    return list;
}
function markSix(list, value) {
    markFour(list, value);
    list.fifth = "five";
    list.sixth = 6.5;
    return list;
}
function describe(list) {
    const holes = [];
    for (let index = 0; index < Math.min(list.length, 200); index++) {
        if (!(index in list))
            holes.push(index);
    }
    const shown = list.length > 12 ? list.slice(0, 4).concat(["..", list.length], list.slice(-3)) : list.slice();
    return JSON.stringify(shown) + " length " + list.length + " holes [" + holes.join() + "] keys " + Object.keys(list).filter((key) => isNaN(key)).join() + " pos " + list.pos + " end " + list.end
        + " kept " + JSON.stringify(list.kept) + " sixth " + list.sixth + " " + Array.isArray(list);
}
const makers = {
    "integers": (n) => [n, n + 1, n + 2],
    "a literal of constants": () => [1, 2, 3],
    "a literal of constants, written": (n) => { const list = [1, 2, 3]; list[1] = n; return list; },
    "doubles": (n) => [n + 0.5, 1.5, 2.5],
    "constant doubles": () => [0.5, 1.5],
    "values": (n) => ["a", { n }, null, undefined],
    "constant strings": () => ["a", "b", "c", "d", "e"],
    "empty": () => [],
    "empty, made with a length": () => new Array(5),
    "one": (n) => [n],
    "a slice": (n) => [n, "x", 2.5, {}].slice(),
    "a slice of constants": () => [7, 8, 9].slice(1),
    "mapped": (n) => [1, 2, 3, 4].map((x) => x * n),
    "holes": (n) => [n, , 3, , 5],
    "pushed": (n) => { const list = []; for (let i = 0; i < 9; i++) list.push(i + n); return list; },
    "sixty-four": (n) => Array.from({ length: 64 }, (_, i) => i + n),
    "sixty-five": (n) => Array.from({ length: 65 }, (_, i) => i + n),
    "a thousand": (n) => Array.from({ length: 1000 }, (_, i) => i * n),
    "sparse": (n) => { const list = [n]; list[100000] = 1; return list; },
    "shifted": (n) => { const list = [0, n, 2, 3, 4]; list.shift(); list.unshift(-1, -2); return list; },
    "shortened": (n) => { const list = [n, 1, 2, 3, 4, 5]; list.length = 2; return list; },
    "of a class below Array": (n) => { class List extends Array {} return List.of(n, 2, 3); },
    "arguments-like": function (n) { return Array.prototype.slice.call(arguments).concat([n]); },
    "spread": (n) => [...[n, 2], ...["x"]],
};
for (const [title, make] of Object.entries(makers)) {
    const said = [];
    for (let round = 0; round < 20; round++) {
        const outcomes = [];
        for (const marker of [mark, markFour, markSix]) {
            const list = marker(make(3), 7);
            outcomes.push(describe(list));
            list.push("pushed");
            list[0] = "first";
            list.pos = "stored again";
            outcomes.push(describe(list));
            list.length = 1;
            list.late = true;
            outcomes.push(describe(list) + " " + list.late);
        }
        const outcome = outcomes.join("\n      ");
        if (said[said.length - 1] !== outcome)
            said.push(outcome);
    }
    lines.push(title + ":\n      " + said.join("\n   >  "));
}

// Lists that take nothing, and a setter above them.
for (const [title, close] of Object.entries({ frozen: Object.freeze, sealed: Object.seal, closed: Object.preventExtensions })) {
    const said = new Set();
    for (let round = 0; round < 10; round++) {
        try {
            said.add(describe(mark(close([1, 2, 3]), round & 1)));
        } catch (error) {
            said.add(error.constructor.name);
        }
    }
    lines.push(title + ": " + [...said].join(" > "));
}
{
    class Watched extends Array {
        set pos(value) { this.seen = value; }
        get pos() { return "got"; }
    }
    const said = new Set();
    for (let round = 0; round < 10; round++)
        said.add(describe(mark(Watched.of(1, 2), 5)) + " seen " + Watched.of(1).seen);
    lines.push("a setter above: " + [...said].join(" > "));
}

// Many lists stay alive over collections, each with what it was given.
const kept = [];
for (let round = 0; round < 30000; round++) {
    const list = markFour([round, "s" + (round & 15), { round }], round);
    if ((round & 7) === 0)
        kept.push(list);
}
let sum = 0;
for (const list of kept)
    sum += list[0] + list[1].length + list[2].round + list.pos + list.end + list.kept.value + (list.flag ? 1 : 0) + list.length;
lines.push("kept " + kept.length + " sum " + sum);
console.log(lines.join("\n"));
