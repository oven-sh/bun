namespace N { export namespace M { export function f(): number { return 1; } } export function g(): number { return M.f() + 1; } }
function often(): number { let s = 0; for (let i = 0; i < 3; i++) s += N.M.f() * 10 + N.g(); return s; }
console.log(N.M.f(), N.g(), often());
if (process.argv.length < 100) (N.M as any).f = () => 4;
console.log(N.M.f(), N.g(), often());
if (process.argv.length < 100) (N as any).M = { f: () => 6 };
console.log(N.M.f(), N.g(), often());
