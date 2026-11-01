// Private members are added to typed objects by code that is evaluated in another realm.
declare const console: { log(...values: unknown[]): void };
// Text is evaluated only where the build sees that the program reaches eval.
eval("0");
const other: any = require("node:vm").runInNewContext("globalThis");
const kit = other.eval(`(() => {
  class ReturnsArgument { constructor(o) { return o; } }
  class Field extends ReturnsArgument { #stamp = "stamp"; static read(o) { return o.#stamp; } static write(o, v) { o.#stamp = v; } static has(o) { return #stamp in o; } }
  class Method extends ReturnsArgument { #m() { return "method"; } static call(o) { return o.#m(); } static has(o) { return #m in o; } }
  class Accessor extends ReturnsArgument { #v = 1; get #a() { return "got " + this.#v; } static get(o) { return o.#a; } }
  class Public extends ReturnsArgument { plain = 1; 0 = 2; }
  return { Field, Method, Accessor, Public, store(o, v) { o.stored = v; }, define(o) { Object.defineProperty(o, "defined", { value: 1 }); } };
})()`);
let one = 1,
  two = 2;
const makers: [string, () => any][] = [
  [
    "function",
    () =>
      function () {
        return 7;
      },
  ],
  ["arrow", () => () => 7],
  ["one capture", () => () => 6 + one],
  ["two captures", () => () => 4 + one + two],
  ["async", () => async () => 7],
  ["bound", () => (() => 6 + one).bind(null)],
];
function called(f: any): unknown {
  const r = f();
  return r && typeof r.then === "function" ? "promise" : r;
}
function line(name: string, f: () => unknown): void {
  try {
    console.log(name + ":", JSON.stringify(f()));
  } catch (e) {
    console.log(name + ": throws", String(e));
  }
}
for (const [kind, make] of makers) {
  line(kind + ": field", () => {
    const f = make();
    new kit.Field(f);
    kit.Field.write(f, "again");
    return [kit.Field.read(f), kit.Field.has(f), called(f)];
  });
  line(kind + ": method", () => {
    const f = make();
    new kit.Method(f);
    return [kit.Method.call(f), kit.Method.has(f), called(f)];
  });
  line(kind + ": accessor", () => {
    const f = make();
    new kit.Accessor(f);
    return [kit.Accessor.get(f), called(f)];
  });
  line(kind + ": public", () => {
    const f = make();
    new kit.Public(f);
    return [f.plain, f[0], Object.keys(f), called(f)];
  });
  line(kind + ": all of them", () => {
    const f = make();
    new kit.Method(f);
    new kit.Field(f);
    new kit.Public(f);
    new kit.Accessor(f);
    kit.store(f, 5);
    kit.define(f);
    return [kit.Method.call(f), kit.Field.read(f), f.plain, kit.Accessor.get(f), f.stored, f.defined, called(f)];
  });
  line(kind + ": twice", () => {
    const f = make();
    new kit.Method(f);
    new kit.Method(f);
    return "no error";
  });
  line(kind + ": 300 through one site", () => {
    let right = 0;
    const kept: any[] = [];
    for (let i = 0; i < 300; i++) {
      const f = make();
      if (i % 2 === 0) new kit.Field(f);
      if (i % 3 === 0) new kit.Method(f);
      if (i % 5 === 0) new kit.Public(f);
      if (i % 7 === 0) kit.store(f, i);
      kept.push(f);
    }
    for (let i = 0; i < 300; i++) {
      const f = kept[i];
      const r = called(f);
      if (
        kit.Field.has(f) === (i % 2 === 0) &&
        kit.Method.has(f) === (i % 3 === 0) &&
        (f.plain === 1) === (i % 5 === 0) &&
        (f.stored === i) === (i % 7 === 0) &&
        (r === 7 || r === "promise") &&
        typeof f === "function"
      )
        right++;
    }
    return right;
  });
}
export {};
