// Static private methods are created once per evaluation of the class.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

const seen: any[] = [];
function look(label: string, K: any) {
  row(label + " same", () => K.same() && K.m() === K.m());
  row(label + " not one seen before", () => seen.every(f => f !== K.m()));
  row(label + " brand", () => K.has(K) + " " + seen.length);
  row(label + " count", () => K.count() + " " + K.count());
  seen.push(K.m());
}
{ class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("block", K); }
if (seen.length) { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("if", K); } else { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("else", K); }
try { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("try", K); throw 1; } catch { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("catch", K); } finally { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("finally", K); }
switch (seen.length) { case 5: { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("case", K); } default: { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("default", K); } }
out: { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("labelled", K); break out; }
for (let i = 0; i < 2; i++) { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("for " + i, K); }
for (const i of [0, 1]) { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("for of " + i, K); }
for (const i in { a: 1, b: 2 }) { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("for in " + i, K); }
let w = 0; while (w < 2) { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("while " + w++, K); }
let d = 0; do { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("do " + d++, K); } while (d < 2);
for (let i = 0, X = class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; i < 2; i++) look("for head " + i + (i ? " (seen)" : ""), i ? class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} : X);
again: for (let i = 0; i < 2; i++) { { class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} look("labelled loop " + i, K); continue again; } }
const comma = (seen.length, class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}); look("comma", comma);
const conditional = seen.length ? class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} : class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; look("conditional", conditional);
const { fromDefault = class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} } = {} as { fromDefault?: any }; look("default of an object pattern", fromDefault);
const [fromArray = class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}] = [] as any[]; look("default of an array pattern", fromArray);
const inLiteral = { k: class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
} }; look("in a literal", inLiteral.k);
const inArray = [class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}, class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}]; look("in an array 0", inArray[0]); look("in an array 1", inArray[1]);
look("an argument", class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
});
const logical = seen[1000] ?? class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; look("nullish", logical);
const iife = (() => class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
})(); look("iife", iife);
const twice = () => class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; look("arrow 0", twice()); look("arrow 1", twice());
class Outer { static inner = class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; static blocked: any; static { Outer.blocked = class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; } static made() { return class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; } }
look("in a static initializer", Outer.inner); look("in a static block", Outer.blocked); look("in a static method 0", Outer.made()); look("in a static method 1", Outer.made());

class Fields { f = class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}; }
look("in an instance field 0", new Fields().f); look("in an instance field 1", new Fields().f);
function defaults(k = class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}) { return k; }
look("in a parameter default 0", defaults()); look("in a parameter default 1", defaults());
const heritage = class extends (class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}) {}; look("in a heritage", Object.getPrototypeOf(heritage));
const tpl = `${(look("in a template", class K {
    static #m() {}
    static #count = 0;
    static m() { return K.#m; }
    static same() { return K.#m === K.#m; }
    static count() { return ++K.#count; }
    static has(v: any) { return #m in v; }
}), "")}`;
