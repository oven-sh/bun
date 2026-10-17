// An array literal in a `switch` case holds the narrowed number; its element is incremented and then read in every way.
declare const console: { log(...a: unknown[]): void };
function row(name: string, f: () => unknown): void { let got: unknown; try { got = f(); } catch (e) { got = "threw " + (e as Error).name + " " + (e as Error).message; } console.log(name + ": " + got); }
function e1(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a[0]; } } }
row("read by a constant index", () => e1(1));
function e2(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const i = a.length - 1; return a[i]; } } }
row("read by a computed index", () => e2(1));
function e3(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; let s = 0; for (const x of a) s += x; return s; } } }
row("for of", () => e3(1));
function e4(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const [y] = a; return y; } } }
row("a pattern", () => e4(1));
function e5(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.at(0); } } }
row("at", () => e5(1));
function e6(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.pop(); } } }
row("pop", () => e6(1));
function e7(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.map(x => x + 1)[0]; } } }
row("map", () => e7(1));
function e8(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return [...a][0]; } } }
row("spread", () => e8(1));
function e9(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; let s = 0; a.forEach(x => { s += x; }); return s; } } }
row("forEach", () => e9(1));
function e10(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.reduce((p: number, c) => p + c, 0); } } }
row("reduce", () => e10(1));
function e11(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const b = a; return b[0]; } } }
row("through another const", () => e11(1));
function first(z: number[]): number { return z[0]; }
function e12(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return first(a); } } }
row("handed to number[]", () => e12(1));
function e13(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.slice()[0]; } } }
row("slice", () => e13(1));
function e14(k: number) { switch (k) { case 1: { const a = [k]; let [w] = a; w++; return w; } } }
row("a let out of a pattern, incremented", () => e14(1));
function e15(k: number) { switch (k) { case 1: { const o = { a: [k] }; o.a[0]++; return o.a[0]; } } }
row("an array in a literal's property", () => e15(1));
function e16(k: number) { switch (k) { case 1: { const m = [[k]]; m[0][0]++; return m[0][0]; } } }
row("an array in an array", () => e16(1));
function e17(k: number) { switch (k) { case 1: { const a = [k]; const up = () => { a[0]++; }; up(); return a[0] === 1; } } }
row("compared behind a closure", () => e17(1));
