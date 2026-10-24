// `made satisfies P`, `made as P` and `made!` are the same object as `made`.
declare const console: { log(...values: unknown[]): void };
interface P { timeout?: number; o0?: number; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number; o11?: number; o12?: number; o13?: number; o14?: number; o15?: number; o16?: number; o17?: number; o18?: number; o19?: number; o20?: number; o21?: number; o22?: number; o23?: number; o24?: number; o25?: number; o26?: number; o27?: number; o28?: number; o29?: number; o30?: number; o31?: number; o32?: number; o33?: number; o34?: number; o35?: number; o36?: number; o37?: number; o38?: number; o39?: number; o40?: number; o41?: number; o42?: number; o43?: number; o44?: number; o45?: number; o46?: number; o47?: number; o48?: number; o49?: number; o50?: number; o51?: number; o52?: number; o53?: number; o54?: number; o55?: number; o56?: number; o57?: number; o58?: number; o59?: number; x?: number; y?: string; m?: () => unknown; inner?: P; readonly g?: number }
interface Config { timeout?: number; retries?: number }
const config = JSON.parse('{"timeout":5}') as Config;
function f(b: number): Omit<P, "x" | "y" | "m" | "inner" | "g"> { return { timeout: b, o0: 0, o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10, o11: 11, o12: 12, o13: 13, o14: 14, o15: 15, o16: 16, o17: 17, o18: 18, o19: 19, o20: 20, o21: 21, o22: 22, o23: 23, o24: 24, o25: 25, o26: 26, o27: 27, o28: 28, o29: 29, o30: 30, o31: 31, o32: 32, o33: 33, o34: 34, o35: 35, o36: 36, o37: 37, o38: 38, o39: 39, o40: 40, o41: 41, o42: 42, o43: 43, o44: 44, o45: 45, o46: 46, o47: 47, o48: 48, o49: 49, o50: 50, o51: 51, o52: 52, o53: 53, o54: 54, o55: 55, o56: 56, o57: 57, o58: 58, o59: 59 } }
function take(p: P): number { let s = (p.timeout ?? 0) + (p.x ?? 0); s += (p.o0 ?? 0) + (p.o59 ?? 0); return s }
function words(e: unknown): string { return "THROWN: " + (e as Error).name }
const made: P = { ...f(1), x: 1 };
const o = made satisfies P; const q = made as P; const r = made!;
console.log(o === made, q === made, r === made, take(o)); made.x = 9; console.log(o.x, q.x, r.x);
console.log(config.timeout);
