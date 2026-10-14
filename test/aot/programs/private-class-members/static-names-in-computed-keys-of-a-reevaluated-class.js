// Computed member keys use static private names of their own class, in a class expression that is evaluated more than once.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
const lines = [];
function row(label, f) { lines.push(label + ": " + said(f)); return "k" + lines.length; }
const o = JSON.parse("{}");
const later = [];
function field(n) { return class C { static #f = n; [row("a field read of another object " + n, () => o.#f)]() {} [row("stored " + n, () => (o.#f = 2))]() {} [row("in " + n, () => #f in o)]() {} static get() { return C.#f; } }; }
function method(n) { return class C { static #m() { return n; } [row("in, a method " + n, () => #m in o)]() {} [row("in, of what is no object " + n, () => #m in 1)]() {} [(later.push((x) => x.#m, (x) => #m in x), "k")]() {} }; }
function fieldKey(n) { return class C { static #f = n; [row("in a field's key " + n, () => o.#f)] = 1; [row("in, in a field's key " + n, () => #f in o)] = 2; }; }
function behind(n) { return class C { [row("ahead of the name " + n, () => #f in o)]() {} [row("read ahead of the name " + n, () => o.#f)]() {} static #f = n; }; }
const F1 = field(1), F2 = field(2), M1 = method(1), M2 = method(2);
fieldKey(1); behind(1);
for (let i = 0; i < 2; i++) { class L { static #f = i; [row("in a loop " + i, () => (#f in o) + " " + said(() => o.#f))]() {} } }
row("an earlier evaluation, asked in the key of a later one", () => { let first; function make() { return class C { static #f = 1; [row("  inside", () => first ? (#f in first) + " " + said(() => first.#f) : "none")]() {} }; } first = make(); make(); return "made"; });
row("behind the declaration", () => F1.get() + " " + F2.get());
row("arrows made in keys, called later", () => said(() => later[0](M1)) + " " + said(() => later[0](M2)) + " " + later[1](M1) + " " + later[1](M2) + " " + said(() => later[2](M2)) + " " + later[3](M1));
for (const line of lines) console.log(line);
