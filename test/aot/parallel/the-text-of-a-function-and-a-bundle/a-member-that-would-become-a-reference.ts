// `(true ? o.m : 0)()` calls the function without `o`. The text that is kept reads `(0, o.m)()`, and likewise under `delete`, for `eval`, and under `typeof` for a name that nothing declares. The layout is the source's own, so the text is printed without its white space.
// Reference: bun build --compile
declare const unbound: unknown;
function shown(o: any): unknown {
  const called = (true ? o.m : 0)();
  const byKey = (true ? o["m"] : 0)();
  const behindAnd = (true && o.m)();
  const nested = (true ? false ? 0 : o.m : 0)();
  const removed = delete (true ? o.gone : 0);
  const evaluated = (true ? eval : 0)("typeof o");
  let kindOfUnbound;
  try {
    kindOfUnbound = typeof (true ? unbound : 0);
  } catch {
    kindOfUnbound = "it throws";
  }
  return [called, byKey, behindAnd, nested, removed, "gone" in o, evaluated, kindOfUnbound];
}
const holder = {
  m(this: unknown) {
    return this === undefined;
  },
  gone: 1,
};
console.log(shown.toString().replace(/\s+/g, ""));
console.log(JSON.stringify(shown({ ...holder })));
console.log(JSON.stringify((0, eval)("'use strict'; (" + shown.toString() + ")")({ ...holder })));
