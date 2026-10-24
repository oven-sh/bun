// Enum members read after the enum object was written to, had a member deleted, or got an accessor.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

enum E { A, B = "b" }
const o: Record<string, unknown> = E;
o.A = 9;
row("an optional chain behind a store", () => E?.A);
row("by a key behind a store", () => E["A"]);
row("the object's own", () => o.A);
delete o.B;
row("an optional chain behind a delete", () => E?.B);
enum G { A }
Object.defineProperty(G, "A", { get() { return "got"; } });
row("an optional chain over an accessor", () => G?.A);
