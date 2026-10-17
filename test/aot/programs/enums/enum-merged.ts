// An enum declared in three parts is one object that gains members as each part runs.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

enum E { A }
const first = E;
row("keys behind the first", () => keys(E));
row("the later member is not there yet", () => "B" in E);
(E as any).mark = 7;
enum E { B = 1 }
row("one object", () => first === E);
row("the mark stays", () => (E as any).mark);
row("keys behind the second", () => keys(E));
enum E { C = "c" }
row("one object still", () => first === E);
row("keys behind the third", () => keys(E));
row("the reverse mapping", () => E[0] + E[1] + String((E as any)["c"]));
enum Never { A } enum Never { B = 1 }
row("control: merged and only read as members", () => Never.A + Never.B);
enum Late { A } enum Late { B = 1 }
row("control: asked for behind both", () => keys(Late));
function inFunction() { enum F { A } const f = F; const k = keys(F); enum F { B = 1 } return [f === F, k, keys(F)].join(" "); }
row("in a function", inFunction);
row("in a function, again", inFunction);
function twoActivations() { enum G { A } return G; }
row("two activations", () => twoActivations() === twoActivations());
namespace N { export enum H { A } export const h = H; export const k = keys(H); export enum H { B = 1 } }
row("in a namespace", () => [N.h === N.H, N.k, keys(N.H)].join(" "));
namespace M { export enum I { A } } namespace M { export enum I { B = 1 } }
row("in two blocks of a namespace", () => keys(M.I));
enum Uses { A = 1 } enum Uses { B = A + 1 }
row("a member of the first in the second", () => keys(Uses) + " " + Uses.B);
enum One { A, B }
const one = One;
row("control: one declaration", () => [one === One, keys(One)].join(" "));
