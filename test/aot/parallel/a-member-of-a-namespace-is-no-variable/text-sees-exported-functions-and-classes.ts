function f() { return "outer f"; }
class C { static n = "outer C"; }
enum E { A = "outer E" }
namespace N {
  export function f() { return "inner f"; }
  export class C { static n = "inner C"; }
  export enum E { A = "inner E" }
  export const seen = eval("f() + ', ' + C.n + ', ' + E.A");
}
console.log(N.seen, f(), C.n, E.A);
