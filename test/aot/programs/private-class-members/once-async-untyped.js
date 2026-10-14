// Static private async methods and generators are created once per evaluation of the class (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

const seen = [];
function look(label, K) { row(label, () => [K.same(), seen.every(f => f !== K.m()), K.has(K), K.count(), K.count()].join()); seen.push(K.m()); }
class First {
    static #m() {}
    static #count = 0;
    static m() { return this.#m; }
    static same() { return this.#m === this.#m; }
    static count() { return ++this.#count; }
    static has(v) { return #m in v; }
} look("ahead of the await", First);
await null;
class Second {
    static #m() {}
    static #count = 0;
    static m() { return this.#m; }
    static same() { return this.#m === this.#m; }
    static count() { return ++this.#count; }
    static has(v) { return #m in v; }
} look("behind the await", Second);
look("the first again (seen)", First);
for await (const i of [0, 1]) { class K {
    static #m() {}
    static #count = 0;
    static m() { return this.#m; }
    static same() { return this.#m === this.#m; }
    static count() { return ++this.#count; }
    static has(v) { return #m in v; }
} look("for await " + i, K); }
const awaited = await (async () => class K {
    static #m() {}
    static #count = 0;
    static m() { return this.#m; }
    static same() { return this.#m === this.#m; }
    static count() { return ++this.#count; }
    static has(v) { return #m in v; }
})(); look("from an async arrow", awaited);
{ await null; class K {
    static #m() {}
    static #count = 0;
    static m() { return this.#m; }
    static same() { return this.#m === this.#m; }
    static count() { return ++this.#count; }
    static has(v) { return #m in v; }
} look("a block behind an await", K); }
