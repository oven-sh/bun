// Enums that merge with ambient `declare enum` declarations before and after them.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

enum E { A }
declare enum E { B = 1 }
row("an ambient declaration behind", () => keys(E));
declare enum F { B = 1 }
enum F { A = 0 }
row("an ambient declaration ahead", () => keys(F));
row("typeof, an ambient declaration ahead", () => typeof F);
row("its member", () => F.A);
declare enum D { A = 1 }
(globalThis as any).D = { A: 2 };
row("a declared enum, the host's value", () => D.A);
declare enum U { A }
(globalThis as any).U = { A: 5 };
row("control: a declared enum without initializers", () => U.A);
