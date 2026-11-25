// Enums that are declared in functions, blocks, methods and static blocks.
function f() { return 3; }
function plainOnes() { enum Inner { A = 7, B, "c-d" = 20, S = "s", N = -1 } return [Inner.B, Inner[8], Inner["c-d"], Inner.S, Inner.N, Object.keys(Inner).join()]; }
function computed() { enum Inner { A = 7, C = f(), D = f() + A, E = "x".length, T = `t${A}`, } return [Inner.C, Inner.D, Inner[3], Inner.E, Inner.T, Object.keys(Inner).join()]; }
function twice() { enum Inner { A = 1 } enum Inner { B = 2 } return Object.keys(Inner).join(); }
function inBlocks(flag: boolean) { const Inner = "outer"; if (flag) { enum Inner { A = 1 } return Inner.A + Inner[1]; } return Inner; }
function fixed() { const enum Inner { A = 4 } return Inner.A; }
function empty() { enum Inner {} return Object.keys(Inner).length; }
class Holder { method() { enum Inner { A = 2 } return Inner[2]; } static held: unknown; static { enum Inner { Z = 9 } Holder.held = Inner[9]; } }
const attempt = (label: string, made: () => unknown) => { try { console.log(label, JSON.stringify(made())); } catch (error) { console.log(label, (error as Error).name); } };
const again = (made: Function): any => (0, eval)("(function (f) { return (" + String(made) + "); })")(f);
for (const made of [plainOnes, computed, twice, fixed, empty]) attempt(made.name, () => [made(), again(made)()]);
attempt("inBlocks", () => [inBlocks(true), inBlocks(false), again(inBlocks)(true), again(inBlocks)(false)]);
attempt("class", () => { const Again = again(Holder); return [new Holder().method(), Holder.held, new Again().method(), Again.held]; });
