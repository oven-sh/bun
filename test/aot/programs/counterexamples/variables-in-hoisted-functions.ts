// Variables without an initializer are assigned and then read by function declarations of the same scope.
declare const console: { log(...values: unknown[]): void };
function may(n: number): number { if (n < 0) throw new Error("no"); return n }
function k(p: number): string { let epoch: number; try { epoch = may(p) } catch { return "k missing" } function mark(): boolean { return epoch > 0 } return mark() ? "k ok" : "k zero" }
function l(p: number): string { let n: number; n = p + 1; function a(): number { return b() + 1 } function b(): number { return n * 2 } return String(a()) }
function m(p: number): string { let n: number; n = p; function down(i: number): number { return i <= 0 ? n : down(i - 1) } return [1, 2].map(x => down(x) + x).join() }
function o(p: number): string { let n: number; if (p > 0) n = 1; else n = 2; function read(): number { return n } const later = { go() { return read() } }; return String(later.go()) }
console.log(k(1), k(-1), k(0), l(2), m(5), o(1), o(0));
