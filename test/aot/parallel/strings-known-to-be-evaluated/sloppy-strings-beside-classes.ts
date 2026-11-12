// What strict code refuses is no error of the build in a string, whoever reads the types of the file.
class Holder {
  static make() {
    return 1;
  }
  #own = [2];
  get first() {
    return this.#own[0];
  }
  map = <T>(f: (x: number) => T) => this.#own.map(f);
}
const attempt = (name: number, f: () => unknown) => {
  try {
    const made: unknown = f();
    console.log(name, typeof made, typeof made === "function" ? made(1) : made);
  } catch (e: any) {
    console.log(name, e.name, e.message);
  }
};
attempt(1, () => new Function("x", "return (function () { return delete x; })();"));
attempt(2, () => new Function("x", "return (function () { arguments = 1; return typeof arguments; })();"));
attempt(3, () => new Function("x", "return (function () { return 010; })();"));
attempt(4, () => new Function("x", "{ function f() { return 1; } function f() { return 2; } } return (() => f())();"));
attempt(5, () => new Function("x", "return (function (a, a) { return a; })(1, 2);"));
attempt(6, () => new Function("x", "var static = 1, let = 2; return (() => static + let)();"));
attempt(7, () => new Function("x", "eval: for (;;) break eval; return (() => x)();"));
attempt(8, () => eval("(function (x) { return delete x; })"));
attempt(10, () => eval("(function (x, x) { return x; })"));
attempt(11, () => eval("(function (x) { return x + 1; })"));
attempt(12, () => new Function("x", "if (x) function f() { return 3; } return (() => f())();"));
attempt(13, () => new Function("x", "undeclared = x; return (() => undeclared + missing)();"));
attempt(14, () => new Function("x", "return (function () { return this.notThere, x.y.z; })();"));
console.log(Holder.make(), new Holder().first, new Holder().map(x => x * 2).join());
export { Holder };
