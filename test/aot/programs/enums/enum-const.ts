// `const enum`: members, access by key, and merged declarations.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

const enum K { A = 1, B = "b" }
row("control: a member", () => K.A + K.B);
row("by a key", () => K["A"]);
const enum Two { A = 1 } const enum Two { B = 2 }
row("merged", () => Two.A + Two.B);
