class C { static s = 1; m(): number { return 2; } }
namespace C { export const t = 3; export function y(): number { return t + 1; } }
function often(): number { let s = 0; for (let i = 0; i < 3; i++) s += C.s + C.y() + new C().m(); return s; }
console.log(C.s, C.t, C.y(), often(), Object.keys(C).join());
if (process.argv.length < 100) (C as any).y = () => 9;
console.log(C.s, C.t, C.y(), often(), Object.keys(C).join());
