// Closures read a number, an object and a string before the variable is assigned.
declare const console: { log(...values: unknown[]): void };
function row(n: string, f: () => unknown) { try { console.log(n + ": " + String(f())) } catch (e) { console.log(n + ": THROWN: " + (e as Error).name + ": " + (e as Error).message.split("\n")[0].slice(0, 120)) } }
function a(k: number): number { let d: number; const f = () => d + 1; const early = f(); d = k; return early + f() }
function b(k: number): string { let s: { x: number }; function f() { return s.x } let got = "none"; try { got = String(f()) } catch (e) { got = "caught " + (e as Error).name } s = { x: k }; return got + " " + f() }
function c(k: number): string { let t: string; const f = () => t; const early = f(); t = "t" + k; return String(early) + " " + f() }
row("a number read too early", () => a(1));
row("an object read too early", () => b(2));
row("a string read too early", () => c(3));
