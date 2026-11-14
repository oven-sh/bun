const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
let fileLet = 2; export const exported = 3;
say(new Function("x", "return this === globalThis;")(1), new Function("x", "return typeof fileLet + typeof exported + x;")(1), new Function("x", "'use strict'; return this === undefined;")(1));
const made = {}; for (const [n, op] of [["add", "+"], ["sub", "-"]]) made[n] = Function("a", "b", "'use strict'; return a " + op + " b;");
say(made.add(1, 2), made.sub(1, 2), made.add);
class C { m() { return Function("x", "return typeof this + x;"); } static s = Function("x", "'use strict'; return x * 2;"); } say(new C().m()(1), C.s(4));
say(Function("x", "undeclaredByFunction = x; return undeclaredByFunction;")(4), globalThis.undeclaredByFunction);
