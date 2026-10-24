// `export const f = function () {}` in a namespace: the name is what plain Bun gives it.
namespace N { export const f = function () {}; }
console.log(JSON.stringify(N.f.name));
