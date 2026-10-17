// What a namespace that merges with a function or with an enum exports is a property of that function or enum.
function f() {}
namespace f { export const v = 1; }
enum E { a }
namespace E { export const v = 1; }
const g = f, G = E;
console.log(f.v, E.v, g.v, G.v, Object.keys(f).join(), Object.keys(E).join());
