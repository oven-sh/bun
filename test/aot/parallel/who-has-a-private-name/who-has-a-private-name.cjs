"use strict";
// `#x in o` asked of objects of every make, before and after the name is laid on them.
class P { #x = 1; static is(o) { return #x in o; } }
class Below extends P { z = 3; }
class Q { y = 2; }
class Wide { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8; }
function Back(o) { return o; }
class Stamp extends Back { #x = 7; static is(o) { return #x in o; } static read(o) { return o.#x; } }
class Method { #m() { return 1; } static is(o) { return #m in o; } }
function make() { return class { #x = 1; static is(o) { return #x in o; } }; }
const First = make(), Second = make();

const said = [];
const say = (what, answer) => said.push(what + ": " + answer);
const all = { P, Stamp, Method, First, Second };
function ask(name, o) { for (const k in all) say(name + " by " + k, all[k].is(o)); }

const q = new Q(), other = new Q(), wide = new Wide(), literal = { "#x": 1, x: 2 }, parsed = JSON.parse('{"x":1}');
for (let round = 0; round < 3; round++) {
    ask("a P", new P());
    ask("one below P", new Below());
    ask("a Q", q);
    ask("another Q", other);
    ask("a wide one", wide);
    ask("a literal with the text as a key", literal);
    ask("a parsed object", parsed);
    ask("a function", Back);
    ask("a list", [1]);
    ask("a proxy", new Proxy(new P(), {}));
    ask("of the first evaluation", new First());
    ask("of the second evaluation", new Second());
    ask("with a private method", new Method());
    if (round === 0) {
        new Stamp(q);
        new Stamp(wide);
        new Stamp(literal);
        new Stamp(parsed);
        say("read off the stamped Q", Stamp.read(q));
    }
    if (round === 1) {
        other[["k", "ey"].join("")] = 1;
        new Stamp(other);
    }
}
for (const nothing of [undefined, null, 1, "text", true, 1n, Symbol.iterator]) {
    try { say("of " + String(nothing), P.is(nothing)); } catch (error) { say("of " + String(nothing), error.constructor.name); }
}
try { new Stamp(q); } catch (error) { say("stamped twice", error.constructor.name); }

// More makes of extra properties than any memo of structures holds: each is asked before it is stamped, behind it, and again.
const each = [];
for (let i = 0; i < 12; i++) { const o = i % 2 ? new Q() : new Wide(); for (let k = 0; k <= i; k++) o[["extra", k].join("")] = k; each.push(o); }
each.forEach((o, i) => say("with " + (i + 1) + " more, unstamped", Stamp.is(o) + " " + P.is(o)));
each.forEach((o, i) => { if (i % 3) new Stamp(o); });
for (let round = 0; round < 2; round++) each.forEach((o, i) => say("with " + (i + 1) + " more", Stamp.is(o) + " " + P.is(o) + " " + (i % 3 ? Stamp.read(o) : "-")));

let many = 0;
const mixed = []; for (let i = 0; i < 64; i++) mixed.push(i % 3 ? new P() : i % 2 ? new Q() : new Wide());
for (let t = 0; t < 2000; t++) for (let i = 0; i < 64; i++) if (P.is(mixed[i])) many += i;
say("many", many);
console.log(said.join("\n"));
