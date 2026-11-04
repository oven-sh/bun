namespace N { export function f(): number { return 1; } }
namespace N { export function g(): number { return f() + 1; } }
function often(): number { let s = 0; for (let i = 0; i < 3; i++) s += N.f() * 10 + N.g(); return s; }
console.log(N.f(), N.g(), often());
if (process.argv.length < 100) (N as any).f = () => 4;
console.log(N.f(), N.g(), often());
