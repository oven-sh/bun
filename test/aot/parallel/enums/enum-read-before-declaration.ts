// An enum is read before its declaration has run: the object, `typeof`, optional chains and `in`.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

function whole() { return E; }
function kind() { return typeof E; }
function chain() { return E?.A; }
function chainByKey() { return E?.["A"]; }
function has() { return "A" in (E as object); }
row("the object ahead", () => whole() === undefined);
row("typeof ahead", kind);
row("an optional chain ahead", chain);
row("an optional chain by a key ahead", chainByKey);
row("in, ahead", has);
enum E { A = 7 }
row("the object behind", () => keys(whole()));
row("typeof behind", kind);
row("an optional chain behind", chain);
row("an optional chain by a key behind", chainByKey);
row("in, behind", has);
function inner() { const f = () => L; const early = f() === undefined; enum L { A } return early + " " + keys(f()); }
row("in a function", inner);
