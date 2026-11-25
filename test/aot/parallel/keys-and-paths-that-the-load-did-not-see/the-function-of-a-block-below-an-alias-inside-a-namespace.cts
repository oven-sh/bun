namespace N { export const b = 1; }
namespace M { import a = N.b; { function a() {} } export const t = typeof a; }
console.log(M.t);
