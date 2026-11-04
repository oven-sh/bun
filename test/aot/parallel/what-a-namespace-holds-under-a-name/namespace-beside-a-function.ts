function f(): number { return 7; }
namespace f { export const x = 8; export function y(): number { return x + 1; } }
function often(): number { let s = 0; for (let i = 0; i < 3; i++) s += f() + f.y(); return s; }
console.log(f(), f.x, f.y(), often(), Object.keys(f).join());
if (process.argv.length < 100) (f as any).y = () => 4;
console.log(f(), f.x, f.y(), often(), Object.keys(f).join());
