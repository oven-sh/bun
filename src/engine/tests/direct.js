// Evaluates to what `direct.rs` needs of a realm: makers of operands, and a way to find the functions of the library.
(() => {
  "use strict";
  let log = "";
  const noisy = (name, value) => ({
    valueOf: () => ((log += name + ".valueOf;"), value),
    toString: () => ((log += name + ".toString;"), "" + value),
  });
  const advanced = (iterator, steps) => {
    while (steps--) iterator.next();
    return iterator;
  };

  const makers = [
    () => ({}),
    () => [1, "a"],
    () => noisy("one", 1),
    () => noisy("text", "b"),
    () => ({ toJSON: () => ((log += "toJSON;"), { a: [1, null] }) }),
    () => ({
      toString() {
        throw new EvalError("refused");
      },
    }),
    () => (...all) => ((log += JSON.stringify(all) + RegExp.lastMatch + ";"), "<" + all[0] + ">"),
    () => () => noisy("result", 7),
    () => () => {
      throw new EvalError("called");
    },
    () => String,
    () => Date,
    () => new Proxy(() => "p", {}),
    () => new String("abc"),
    () => Object.assign(new String("abc"), { toString: () => "own" }),
    () => new (class extends String {})("sub"),
    () => new Number(5),
    () => Symbol.iterator,
    () => Symbol.for("registered"),
    () => Symbol("é日"),
    () => Symbol(),
    () => advanced("ab"[Symbol.iterator](), 0),
    () => advanced("ab"[Symbol.iterator](), 2),
    () => advanced("ab"[Symbol.iterator](), 3),
    () => advanced("é😀\ud83d"[Symbol.iterator](), 1),
    () => advanced(("😀" + log.length)[Symbol.iterator](), 0),
    () => advanced("abab".matchAll(/(a)|x*/g), 1),
    () => advanced("abab".matchAll(/b/g), 2),
    () => advanced(RegExp.prototype[Symbol.matchAll].call(/b/, "abab"), 0),
    () => new (class extends Date {})(86400000),
    () => Object.assign(new Date(0), { toISOString: () => "own", valueOf: () => 1 }),
    () => Object.freeze(/b/g),
    () => Object.freeze(/b/),
    () => Object.assign(/b/g, { extra: 1 }),
    () => Object.assign(/b/g, { exec: () => ((log += "exec;"), null) }),
    () => Object.defineProperty(/b/, "global", { value: true }),
    () => new (class extends RegExp {})("b", "y"),
  ];
  const matchers = [
    () => /b/,
    () => /a*?/y,
    () => /(?:)/,
    () => /(?:)/gu,
    () => Object.assign(/b/g, { extra: 1 }),
    () => Object.assign(/b/g, { exec: () => ((log += "exec;"), null) }),
  ];
  const changes = [
    () => {},
    Object.freeze,
    it => it.compile("(a)|$", "dg"),
    it => (it.lastIndex = 1.5),
    it => (it.lastIndex = 2 ** 40),
    it => (it.lastIndex = noisy("lastIndex", 1)),
  ];
  for (const make of matchers)
    for (const change of changes)
      makers.push(() => {
        const matcher = make();
        const constructor = {
          [Symbol.species]: function () {
            return matcher;
          },
        };
        const iterator = "😀abab".matchAll(Object.assign(/x/gu, { constructor }));
        change(matcher);
        return iterator;
      });
  for (const bigint of [0n, 1n, -1n, 255n, -(2n ** 63n), 2n ** 64n - 1n, 10n ** 30n, -(2n ** 1024n)])
    makers.push(() => bigint);
  for (const time of [0, -1, 999, 951782400000, 1710054000123, 1730613599999, -62198755200000, 8.64e15, -8.64e15, NaN])
    makers.push(() => new Date(time));
  const patterns = ["b", "(a)(x)?", "(?<first>a)|(?<second>c)", "a*?", "", "^", "$", "\\s+|,", ".", "[^a-c]", "(?<=a)b"];
  for (const source of patterns)
    for (const flags of ["", "g", "y", "gy", "d", "gu", "im", "gsv"])
      for (const lastIndex of [0, 0, 1, 3, 100]) makers.push(() => Object.assign(new RegExp(source, flags), { lastIndex }));
  for (const flags of ["", "g", "y"]) {
    for (const lastIndex of [-1, -0, 1.5, NaN, 2 ** 32 + 1, 2 ** 53, Infinity, "1", undefined])
      makers.push(() => Object.assign(new RegExp("b", flags), { lastIndex }));
    makers.push(() => {
      const regexp = new RegExp("b", flags);
      regexp.lastIndex = { valueOf: () => (regexp.compile("(c)", "g"), 1) };
      return regexp;
    });
  }

  const functions = () => {
    const seen = new Set([globalThis, ""[Symbol.iterator](), "".matchAll(/./g)]);
    for (const object of seen) {
      const parts = Reflect.ownKeys(object).map(key => Reflect.getOwnPropertyDescriptor(object, key));
      for (const part of [Reflect.getPrototypeOf(object), ...parts.flatMap(it => [it.value, it.get])])
        if (Object(part) === part) seen.add(part);
    }
    return [...seen].filter(it => typeof it === "function");
  };

  const takeLog = () => {
    const taken = log;
    log = "";
    return taken;
  };

  return { makers, functions, takeLog, unwanted: noisy("unwanted", 2) };
})();
