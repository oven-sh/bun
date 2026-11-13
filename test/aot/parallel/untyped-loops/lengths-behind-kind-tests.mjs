function a(xs) { let s = 0; for (let i = 0; i < xs.length; i++) { const v = xs[i]; if (Array.isArray(v)) s += 1; else s += v.length; } return s; }
function b(xs, x, o) { let s = 0; for (let i = 0; i < xs.length; i++) { if (Array.isArray(x)) s += 1; else s += x.length; o.length = i; } return s; }
function c(xs) { let s = 0; for (const v of xs) { if (Array.isArray(v)) s += v.length; else if (typeof v === "string") s += v.length; else s += v.length; } return s; }
function d(xs, x, o) { let s = 0; for (let i = 0; i < xs.length; i++) { if (typeof x === "string") s += 1; else s += x.length; o.length = i; } return s; }
function e(xs, x, o) { let s = 0; for (let i = 0; i < xs.length; i++) { if (Array.isArray(x)) s += x.length; o.length = i; } return s; }
function g(xs, x, o) { let s = 0; if (!Array.isArray(x)) for (let i = 0; i < xs.length; i++) { s += x.length; o.length = i; } return s; }
function h(xs, x, o) { let s = 0; if (typeof x !== "string") for (let i = 0; i < xs.length; i++) { s += x.length; o.length = i; } return s; }
function k(xs, x, o) { let s = 0; if (Array.isArray(x)) for (let i = 0; i < xs.length; i++) { s += x.length; o[o.length] = i; } return s; }
function l(xs, x, o) { let s = 0; if (typeof x === "string") for (let i = 0; i < xs.length; i++) { s += x.length; o.length = i; } return s; }
function m(xs, x, o) { let s = 0; if (x instanceof Uint8Array) for (let i = 0; i < xs.length; i++) { s += x.length; o.length = i; } else for (let i = 0; i < xs.length; i++) { s += x.length; o.length = i; } return s; }
const ops = { a, b, c, d, e, g, h, k, l, m };
const kinds = [() => [1, 2], () => "abc", () => ({ length: 2 }), () => new Uint8Array(3), () => ({}), () => new Float64Array(2)];
for (const f in ops) for (const x of kinds) for (const o of kinds) { let r; try { r = ops[f](["ab", [1], { length: 4 }, new Uint8Array(2)], x(), o()); } catch (error) { r = error.name; } console.log(f, r); }
