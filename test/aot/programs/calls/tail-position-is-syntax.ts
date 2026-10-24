// Which calls are tail calls is decided by syntax alone, as stack traces show. Plain Bun's transpiler puts the initializer of a `const` that is used once in the place of its use, which makes `const r = f(n - 1); return r` a tail call there; compiled code goes by the text as written, with or without the types.

declare const console: any;
function attempt(n: string, f: () => unknown): void { try { console.log(n + ": " + JSON.stringify(f())); } catch (e: any) { console.log(n + ": throws " + e.constructor.name); } }
const N = 1000000;
function throughConst(n: number): number { if (n === 0) return 0; const r = throughConst(n - 1); return r; }
function throughLet(n: number): number { if (n === 0) return 0; let r = throughLet(n - 1); return r; }
const throughArrow = (n: number): number => { if (n === 0) return 0; const r = throughArrow(n - 1); return r; };
class Through { walk(n: number): number { if (n === 0) return 0; const r = this.walk(n - 1); return r; } }
attempt("through a const", () => { const r = throughConst(N); return r; });
attempt("through a let", () => { const r = throughLet(N); return r; });
attempt("through a const in an arrow", () => { const r = throughArrow(N); return r; });
attempt("through a const in a method", () => { const r = new Through().walk(N); return r; });
function framesOf(e: any): string { const all = String(e.stack).split("\n").map((l: string) => /(k_[a-z]+)/.exec(l)).filter(Boolean).map((m: any) => m[1]).join(); return all; }
function k_leaf(): Error { const e = new Error("x"); return e; }
function k_two(): Error { const e = k_leaf(); return e; }
function k_three(): Error { const e = k_two(); return e; }
function k_deep(n: number): Error { if (n === 0) { const made = new Error("deep"); return made; } const e = k_deep(n - 1); return e; }
function k_report(f: () => Error): string { const e = f(); const s = framesOf(e); return s; }
attempt("frames: a const three times", () => { const s = k_report(k_three); return s; });
attempt("frames: deep", () => { const s = k_report(() => { const e = k_deep(4); return e; }); return s; });
function k_captures(cut: Function): any { const o: any = {}; (Error as any).captureStackTrace(o, cut); return o; }
function k_outer(cut: Function): any { const o = k_captures(cut); return o; }
function k_top(cut: Function): string { const o = k_outer(cut); const s = framesOf(o); return s; }
attempt("captureStackTrace: cut at the outer one", () => { const s = k_top(k_outer); return s; });
attempt("captureStackTrace: cut at the inner one", () => { const s = k_top(k_captures); return s; });
export {};
