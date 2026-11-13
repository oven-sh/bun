// Loops store under a key that is known at run time alone into objects whose literal or class does not list all fields, and read the fields by name behind the store.
const key = JSON.parse('"vx"'), other = JSON.parse('"m"');
const lines = [];
const tell = value => (Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "object" : String(value));
const show = object => Reflect.ownKeys(object).map(name => String(name) + ":" + tell(object[name])).join();
const say = (name, answer, ...objects) => lines.push([name, tell(answer), ...objects.map(show)].join(" "));

const point = i => { const o = { x: i }; o.vx = i; return o; };
function step(o, n) { let s = 0; for (let i = 0; i < n; i++) { o[key] += 1; s += o.vx; } return s; }
for (const n of [1, 3]) { const o = point(2); say("step", step(o, n), o); }

const speed = i => { const o = { y: i }; o.vx = i; return o; };
function replace(o, n) { let s = 0; for (let i = 0; i < n; i++) { o[key] = i; s += o.vx; } return s; }
for (const n of [1, 3, 12]) { const o = speed(2); say("replace", replace(o, n), o); }

const body = i => { const o = { z: i }; if (i) o.vx = i; o.m = 0; return o; };
function nest(h, n) {
    let s = 0;
    const a = h.p, b = h.q;
    for (let j = 0; j < 2; j++) {
        for (let i = 0; i < n; i++) { b.vx -= 1; b[key] += 1; b[key] += 1; s += a.vx; }
    }
    return s;
}
for (const n of [1, 4, 11]) {
    const p = body(2), q = body(1);
    say("nest", nest({ p, q: p }, n), p);
    say("nest", nest({ p, q }, n), p, q);
}

class Plain { constructor(i) { this.x = i; } fill(i) { this.vx = i; this.m = 1; return this; } }
function down(a, n) { let s = 0; for (let i = n; i > 0; i--) { a[key] += 1; a.x--; s += a["vx"]; } return s; }
for (const n of [1, 3, 8]) { const o = new Plain(n).fill(2); say("down", down(o, n), o); }

const late = i => { const o = { w: i }; o.vx = i; o.m = 0; return o; };
const kinds = [late, i => JSON.parse(`{"w":${i},"y":${i + 0.5},"vx":${i % 3 - 1},"m":${i % 2}}`), i => Object.create({ vx: 5, m: 1, w: i }), i => ({ w: i, vx: 1, m: 0, get id() { return this.vx; } })];
function several(c, n) { let s = 0; for (let i = 0; i < n; i++) { c[key] = i & 1; c.w--; s += c.vx; s += c["vx"]; } return s; }
function names(h, n) {
    let s = 0;
    const a = h.p, b = h.q;
    for (let j = 0; j < 2; j++) {
        for (let i = 0; i < n; i++) { b.vx -= 1; b[key] += 1; b[key] += 1; s += a.vx; }
    }
    return s;
}
for (const kind of kinds) {
    for (const n of [1, 4, 11]) {
        const o = kind(2), p = kind(1);
        say("several", several(o, n), o);
        say("names", names({ p: o, q: o }, n), o);
        say("names", names({ p: o, q: p }, n), o, p);
    }
}

const numbers = i => { const o = { u: i }; o.vx = i * 0.5; o.m = i; return o; };
function texts(o, n) { let s = ""; for (let i = 0; i < n; i++) { o[key] = i & 1 ? "t" + i : i; s += o.vx; o[other] ??= 1; s += o.m; } return s; }
for (const n of [1, 3, 8]) { const o = numbers(3); say("texts", texts(o, n), o); }

const marked = Symbol("marked");
const symbols = i => { const o = { v: i }; o[marked] = i; o.vx = i; return o; };
function underSymbol(o, name, n) { let s = 0; for (let i = 0; i < n; i++) { o[name] += 2; s += o[marked]; s += o.vx; } return s; }
for (const n of [1, 3, 8]) { const o = symbols(3); say("underSymbol", underSymbol(o, marked, n), o); say("underSymbol", underSymbol(o, key, n), o); }

const held = i => { const o = { t: i }; o.vx = i; o.m = 1; return o; };
function frozen(o, n) { "use strict"; let s = 0; for (let i = 0; i < n; i++) { o[key] += 1; s += o.vx; } return s; }
for (const keep of [o => o, Object.seal, Object.freeze, o => { delete o.vx; o.vx = 4; return o; }, o => Object.defineProperty(o, "vx", { get() { return this.m; }, set(v) { this.m = v; } })]) {
    for (const n of [1, 3, 8]) {
        const o = keep(held(2));
        try { say("frozen", frozen(o, n), o); } catch (error) { say(error.name, 0, o); }
    }
}
console.log(lines.join("\n"));
