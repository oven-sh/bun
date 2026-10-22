// A sloppy direct eval declares in the function that called it, also from inside catch (e). In a strict caller the eval keeps its declarations.
module.exports = {};

function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}

function declares(a) {
  eval("var x = 1; var a = 2; function g() { return x }");
  return [x, a, g()];
}
show("var, parameter and function", () => declares(0));
show("declared again on the next call", () => declares(0));

function declaresTwice() {
  eval("var t = 1; function h() { return 1 }");
  eval("var t = t + 1; function h() { return 2 }");
  return [t, h()];
}
show("same name from two calls", declaresTwice);

function deletes() {
  eval("var d = 1");
  const didDelete = delete d;
  return [didDelete, typeof d];
}
show("delete", deletes);

function createCounter() {
  eval("var count = 1; var setCount = function (value) { count = value };");
  return { setCount, getCount: () => count };
}
const counter = createCounter();
counter.setCount(5);
show("closure stores after return", () => counter.getCount());

function redeclaresBlockLet() {
  {
    let y = 1;
    eval("var y = 2");
    return y;
  }
}
show("var over let in a block", redeclaresBlockLet);

function redeclaresCatchParameter() {
  try {
    throw 1;
  } catch (e) {
    eval("var e = 2");
    return e;
  }
}
show("var over the parameter of catch (e)", redeclaresCatchParameter);

function redeclaresCatchPattern() {
  try {
    throw { e: 1 };
  } catch ({ e }) {
    eval("var e");
    return e;
  }
}
show("var over the parameter of catch ({ e })", redeclaresCatchPattern);

// Class code is always strict. Plain Bun's transpiler drops a "use strict" directive inside a function, which would leave the reference run without a strict caller.
class StrictCode {
  static declares = function () {
    eval("var z = 1");
    return typeof z;
  };
}
show("var in a strict caller", StrictCode.declares);
show("nothing on the global object", () => [typeof globalThis.x, typeof globalThis.g, typeof globalThis.e, typeof globalThis.z]);
