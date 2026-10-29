import * as ns from "./m";
import inner = ns.inner;
import f = inner.f;
namespace Local {
  import g = ns.g;
  export const value = g();
}
console.log(f(1), Local.value);
