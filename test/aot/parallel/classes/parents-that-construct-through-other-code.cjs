// super() in a loop, after the parent of the class was replaced: a proxy, a function, a bound function and a class of another text run for every instance, and only a built-in constructor makes the instance itself.
"use strict";
const lines = [];
const say = (...words) => lines.push(words.join(" "));
const unseen = value => JSON.parse("[0]", (key, old) => key === "0" ? value : old)[0];
let ran = 0;
class OfMap extends Map { constructor() { super(); this.a = 1; } }
class OfSet extends Set { constructor() { super(); this.a = 1; } }
class OfDate extends Date { constructor() { super(); this.a = 1; } }
class OfArray extends Array { constructor() { super(); this.a = 1; } }
class OfBytes extends Uint8Array { constructor() { super(2); this.a = 1; } }
class OfError extends Error { constructor() { super("text"); this.a = 1; } }
class OfObject extends Object { constructor() { super(); this.a = 1; } }
class OfPattern extends RegExp { constructor() { super("a"); this.a = 1; } }
class OfWeak extends WeakMap { constructor() { super(); this.a = 1; } }
class OfHandedOn extends Map { constructor(...all) { super(...all); this.a = 1; } }
const makers = {
    OfMap: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfMap(); return kept; },
    OfSet: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfSet(); return kept; },
    OfDate: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfDate(); return kept; },
    OfArray: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfArray(); return kept; },
    OfBytes: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfBytes(); return kept; },
    OfError: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfError(); return kept; },
    OfObject: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfObject(); return kept; },
    OfPattern: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfPattern(); return kept; },
    OfWeak: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfWeak(); return kept; },
    OfHandedOn: (n, kept) => { for (let i = 0; i < n; i++) kept[i & 3] = new OfHandedOn(); return kept; },
};
const classes = unseen({ OfMap, OfSet, OfDate, OfArray, OfBytes, OfError, OfObject, OfPattern, OfWeak, OfHandedOn });
const parents = {
    proxy: up => new Proxy(up, { construct(target, all, newTarget) { ran++; return Reflect.construct(target, all, newTarget); } }),
    proxyOfProxy: up => new Proxy(new Proxy(up, {}), { construct(target, all, newTarget) { ran++; return Reflect.construct(target, all, newTarget); } }),
    silent: up => new Proxy(up, {}),
    function: up => unseen(function (...all) { ran++; return Reflect.construct(up, all, new.target); }),
    bound: up => unseen(function (...all) { ran++; return Reflect.construct(up, all, new.target); }).bind(null),
    boundToArguments: up => up === Map ? Map.bind(null, [[1, 2], [3, 4]]) : up === Set ? Set.bind(null, [1, 2, 3]) : up.bind(null),
    evaluated: up => { const made = (0, eval)("(up, note) => class extends up { constructor(...all) { super(...all); note(); } }"); return made(up, () => ran++); },
};
for (const name of Object.keys(classes)) {
    const own = classes[name], up = Object.getPrototypeOf(own), make = makers[name];
    make(8, []);
    for (const kind of Object.keys(parents)) {
        Object.setPrototypeOf(own, parents[kind](up));
        ran = 0;
        const kept = make(5, []);
        say(name, kind, ran, kept.map(made => [made.a, made instanceof own, made.size, made.length].join(":")).join());
        Object.setPrototypeOf(own, up);
        ran = 0;
        make(3, []);
        say(name, "again", ran);
    }
}
for (const line of lines) console.log(line);
