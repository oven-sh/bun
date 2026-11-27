// Evaluated text that stores into properties beside fields that are not writable, are accessors, or are gone.
"use strict";
const lines = [], say = (...words) => lines.push(words.map(w => typeof w === "string" ? w : JSON.stringify(w)).join(" "));
const unknown = process.argv.length > 90 ? "return;" : "", hide = v => [v, 0][process.argv.length > 90 ? 1 : 0];
const made = (...words) => new Function(...words.slice(0, -1), unknown + words[words.length - 1]);
const set = made("o", "v", "o.path = v; return o.path;"), setFour = made("o", "v", "o.path = v; o.next = [v]; o.third = v; o.fourth = { v }; return o;");
const shapes = hide([i => ({ code: "a", input: i }), i => ({ code: "b", values: ["x", i], inst: null }), i => ({ code: "c", input: "y", inst: null, pattern: "p" + i }), () => ({})]);
const add = hide((o, v) => { o.path = v; return o; }), addMore = hide(o => { o.next = 1; o.third = 2; o.fourth = 3; o.fifth = 4; return o; });
const values = hide([1, -0, 0.5, "s", null, undefined, true, { v: 1 }, [1, 2], 2147483648, NaN]);
const told = f => { try { const r = f(); return r === undefined ? "done" : String(r); } catch (e) { return e.constructor.name + ": " + e.message; } };
for (let turn = 0; turn < 3; turn++) {
    const frozen = Object.freeze(add(shapes[0](1), 1)); say(told(() => set(frozen, 2)), frozen);
    const sealed = Object.seal(add(shapes[1](1), 1)); say(told(() => set(sealed, 2)), sealed);
    const fixed = add(shapes[2](1), 1); Object.defineProperty(fixed, "path", { writable: false }); say(told(() => set(fixed, 2)), fixed);
    const getter = add(shapes[0](1), 1); let seen = []; Object.defineProperty(getter, "path", { get() { return "got"; }, set(v) { seen.push(v); }, enumerable: true, configurable: true }); say(told(() => set(getter, 3)), seen, getter);
    const gone = add(shapes[0](1), 1); delete gone.path; say(told(() => set(gone, 4)), gone, Object.keys(gone)); delete gone.path; gone.late = 1; say(told(() => set(gone, 5)), Object.keys(gone));
    const below = Object.create(add(shapes[0](1), 1)); say(told(() => set(below, 6)), below, Object.getPrototypeOf(below).path);
    const only = add({ code: "z" }, 1); say(told(() => set(only, 7)), told(() => set(Object.preventExtensions(only), 8)), only);
}
class Issue { constructor(c) { this.code = c; } } const heirs = []; for (let i = 0; i < 60; i++) { const o = add(new Issue(i), i); set(o, "h" + i); if (i % 9 === 0) heirs.push(o); } say(heirs);
const proto = {}; Object.defineProperty(proto, "path", { set(v) { this.kept = v; }, get() { return this.kept; } }); const withSetter = Object.setPrototypeOf({ code: "q" }, proto); say(told(() => set(withSetter, 9)), withSetter.kept, Object.keys(withSetter));
const vm = require("vm"), elsewhere = vm.runInContext(unknown + "(function (o, v) { o.path = v; return o.path; })", vm.createContext({})); for (let i = 0; i < 6; i++) { const o = add(shapes[i % 4](i), 0); say(elsewhere(o, { i }), o); }
const inLoop = made("list", "for (const iss of list) { iss.path = iss.path ? ['k', ...iss.path] : ['k']; } return list;"); for (let turn = 0; turn < 12; turn++) { const list = [add(shapes[0](1), ["a"]), shapes[1](2), add(shapes[2](3), ["b", 1])]; say(inLoop(list), inLoop(list).map(o => o.path.join("."))); }
console.log(lines.join("\n"));
