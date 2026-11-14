// `Function` makes sloppy functions in a module too.
const attempt = (name: number, f: () => unknown) => {
  try {
    console.log(name, f());
  } catch (e: any) {
    console.log(name, e.name, e.message);
  }
};
attempt(1, () => new Function("return typeof this; function f() {}")());
attempt(2, () => new Function("return (function () { return this === globalThis; })();")());
attempt(3, () => new Function("x", "undeclaredByString = x; return (function () { return undeclaredByString; })();")(3));
attempt(4, () => (globalThis as any).undeclaredByString);
attempt(5, () => new Function("a", "a = 2; return (function () { return 0; })() + arguments[0];")(1));
attempt(6, () => new Function("a", "arguments[0] = 5; return (() => a)();")(1));
attempt(7, () => new Function("return (function (a, a) { return a; })(1, 2);")());
attempt(9, () => new Function("x", "return (function () { return delete x; })();")(1));
attempt(8, () => new Function("if (true) { function inner() { return 4; } } return inner();")());
attempt(10, () => new Function("v", "this.freshByString = v; return (() => freshByString)();")(6));
attempt(11, () => new Function("n", "return (() => typeof this[n])();")("Map"));
attempt(12, () => new Function("x", "return (() => this.Math.max(x, 2))();")(1));
attempt(13, () => new Function("return (function () { return typeof arguments.callee; })();")());
attempt(14, () => new Function("return (function f() { f = 1; return typeof f; })();")());
attempt(15, () => new Function("var undefined = 5; return (() => typeof undefined)();")());
attempt(16, () => new Function("'s'.length = 1; return (() => 's'.length)();")());
attempt(17, () => new Function("x", "x.y = 2; return (() => x.y)();")(Object.freeze({ y: 1 })));
attempt(18, () => new Function("var let = 1, static = 2, yield = 3; return (() => let + static + yield)();")());
attempt(19, () => new Function("return (function () { 'use strict'; return typeof this; })();")());
attempt(20, () => new Function("'use strict'; return (function () { return typeof this; })();")());
attempt(21, () => new Function("return (function () { return typeof this; }).call(5);")());
attempt(22, () => new Function("f", "return (() => f())();")(function (this: any) { return typeof this; }));
attempt(23, () => new Function("return (() => typeof attempt)();")());
attempt(24, () => new Function("eval = (() => eval)(); return 1;").length);
attempt(25, () => String(new Function("a", "b", "return (() => a + b)();")));
attempt(26, () => typeof eval("(function () { return this; })")());
attempt(27, () => { class Holder { static make() { return new Function("return (function () { return typeof this; })();"); } } return Holder.make()(); });
attempt(28, () => [1, 2, 3].map(new Function("x", "return (() => typeof this + x)();") as any).join());
attempt(29, () => new (new Function("x", "this.x = (() => x)();") as any)(7).x);
attempt(30, () => { let sum = 0; const add = new Function("a", "b", "return (function () { return a + b; })();"); for (let i = 0; i < 2000; i++) sum = add(sum, i); return sum; });
export {};
