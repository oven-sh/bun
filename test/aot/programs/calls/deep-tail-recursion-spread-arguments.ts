// Recursion a million calls deep through tail calls whose arguments travel as a list in memory: many arguments, rest parameters, `arguments`, spread and apply.
declare const console: any;
function attempt(name: string, f: () => unknown) { try { console.log(name + ": " + f()); } catch (e: any) { console.log(name + ": " + e.constructor.name); } }
const N = 1_000_000;
// More arguments than argument registers.
function five(n: any, f: any, a: any, b: any, c: any): any { return n === 0 ? a + b + c : f(n - 1, f, c, a, b); }
attempt("five arguments by value", () => five(N, five, 1, 2, 3));
function twoParameters(n: any, f: any): any { return n === 0 ? "done" : f(n - 1, f, 1, 2, 3, 4, 5, 6, 7, 8); }
attempt("ten arguments passed to two parameters", () => twoParameters(N, twoParameters));
// The callee takes its arguments as a list: a rest parameter, `arguments`, more parameters than argument registers.
function restByValue(n: any, f: any, ...more: any[]): any { return n === 0 ? more.length : f(n - 1, f, 1, 2); }
attempt("a rest parameter by value", () => restByValue(N, restByValue));
function argumentsByValue(n: any, f: any): any { return n === 0 ? arguments.length : f(n - 1, f); }
attempt("arguments by value", () => argumentsByValue(N, argumentsByValue));
function sixParameters(n: any, f: any, a?: any, b?: any, c?: any, d?: any): any { return n === 0 ? String(d) : f(n - 1, f); }
attempt("six parameters, two passed, by value", () => sixParameters(N, sixParameters));
const typedFive = (n: number, f: (n: number, f: any, a: number, b: number, c: number) => number, a: number, b: number, c: number): number => (n === 0 ? a + b + c : f(n - 1, f, c, a, b));
attempt("five typed arguments by value", () => typedFive(N, typedFive, 1, 2, 3));
class Many { m(n: number, a: number, b: number, c: number, d: number, e: number): number { return n === 0 ? a + e : (this as any).m(n - 1, e, a, b, c, d); } }
attempt("a method by name with six arguments", () => new Many().m(N, 1, 2, 3, 4, 5));
function spreadByValue(n: any, f: any, list: any[]): any { return n === 0 ? list.length : f(...[n - 1, f, list]); }
attempt("a spread by value", () => spreadByValue(N, spreadByValue, [1, 2, 3, 4, 5, 6]));
function applyLong(n: any, a: any, b: any, c: any, d: any, e: any): any { return n === 0 ? e : applyLong.apply(undefined, [n - 1, e, a, b, c, d]); }
attempt("apply with six arguments", () => applyLong(N, 1, 2, 3, 4, 5));
function spreadOfVariable(list: any[]): any { if (list[0] === 0) return list.length; list[0]--; return list[1](...list); }
attempt("a spread of a variable, three elements", () => spreadOfVariable([N, spreadOfVariableRest, 1]));
function spreadOfVariableRest(...list: any[]): any { if (list[0] === 0) return list.length; list[0]--; return list[1](...list); }
attempt("a spread of a rest parameter, three elements", () => spreadOfVariableRest(N, spreadOfVariableRest, 1));
attempt("a spread of a rest parameter, seven elements", () => spreadOfVariableRest(N, spreadOfVariableRest, 1, 2, 3, 4, 5));
function applyOfVariable(this: any, n: any, f: any, a: any, b: any, c: any, d: any): any { if (n === 0) return d; const list = [n - 1, f, d, a, b, c]; return f.apply(this, list); }
attempt("apply of a variable, six elements", () => applyOfVariable(N, applyOfVariable, 1, 2, 3, 4));
const forward = (...all: [any, any, any]): any => target(...all);
function target(n: any, a: any, b: any): any { return n === 0 ? a + b : forward(n - 1, b, a); }
attempt("a forwarding wrapper", () => target(N, 1, 2));
function wrapperTarget(n: any, a: any): any { return n === 0 ? a : applyWrapper(n - 1, a + 1); }
function applyWrapper(this: any, ..._: any[]): any { return wrapperTarget.apply(this, arguments as any); }
attempt("a wrapper that applies arguments", () => wrapperTarget(N, 0));
const applyWrapperByValue: any = function (this: any) { return (wrapperTargetByValue as any).apply(this, arguments); };
const wrapperTargetByValue: any = function (n: any, a: any) { return n === 0 ? a : applyWrapperByValue(n - 1, a + 1); };
function spreadLong(...list: any[]): any { if (list[0] === 0) return list.length + ":" + list[39]; list[0]--; return list[1](...list); }
attempt("a spread of forty elements", () => spreadLong(N, spreadLong, ...Array.from({ length: 38 }, (_, i) => i)));
function applyDoubles(this: any, n: any, f: any, ...rest: number[]): any { if (n === 0) return rest.length + ":" + rest[29]; const doubles = rest.map(x => x + 0.5); return f.apply(this, [n - 1, f].concat(doubles)); }
attempt("apply of a list that ends in thirty doubles", () => applyDoubles(2000, applyDoubles, ...Array.from({ length: 30 }, (_, i) => i + 0.25)));
function onlyDoubles(...list: number[]): any { if (list[0] <= 0.5) return list.length + ":" + list[11]; list[0] -= 1; return doublesTable[0](...list); }
const doublesTable: any[] = [onlyDoubles];
attempt("a spread of twelve doubles", () => onlyDoubles(N + 0.5, ...Array.from({ length: 11 }, (_, i) => i + 0.75)));
attempt("a wrapper that applies arguments, by value", () => wrapperTargetByValue(N, 0));
