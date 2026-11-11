// The methods that call a function, called by value on lists of every kind and on what is none.
const z = JSON.parse("0"),
  hide = x => [x][z],
  out = [],
  log = [];
const show = v =>
  JSON.stringify(v, (k, x) =>
    x === undefined
      ? "U"
      : typeof x === "function"
        ? "f"
        : typeof x === "bigint"
          ? x + "n"
          : Object.is(x, -0)
            ? "-0"
            : x,
  );
const t = (n, f) => {
  try {
    out.push(n + ":" + show(f()) + log.splice(0).join(""));
  } catch (e) {
    out.push(n + "!" + e.name + e.message.length + log.splice(0).join(""));
  }
};
const lists = {
  ints: () => [1, 2, 3],
  doubles: () => [0.5, -0, 2],
  texts: () => ["a", "b"],
  mixed: () => [1, "x", null, undefined, {}],
  none: () => [],
  holes: () => [1, , 3],
  far: () => {
    const a = [1, 2];
    a[400] = 3;
    return a;
  },
  sparse: () => {
    const a = [];
    a.length = 4294967295;
    a[2] = "m";
    return a;
  },
  getter: () =>
    Object.defineProperty([1, 2, 3], 1, {
      get() {
        log.push("g");
        return 9;
      },
      configurable: true,
    }),
  frozen: () => Object.freeze([4, 5]),
  heir: () => new (class H extends Array {})(5, 6),
  species: () => {
    const a = [1, 2];
    a.constructor = {
      [Symbol.species]: function (n) {
        log.push("s" + n);
        return { length: 0 };
      },
    };
    return a;
  },
  above: () => Object.setPrototypeOf([1, , 3], Object.create(Array.prototype, { 1: { value: "P" } })),
  view: () => new Uint8Array([7, 8]),
  args: () =>
    (function () {
      return arguments;
    })(1, 2),
  like: () => ({ length: 2, 0: "x", 1: "y" }),
  long: () => ({
    length: 2 ** 32 + 2,
    get 0() {
      log.push("0");
      return "a";
    },
  }),
  lazy: () => ({
    get length() {
      log.push("l");
      return 2;
    },
    0: "x",
    1: "y",
  }),
  proxy: () =>
    new Proxy([1, 2], {
      get(t, k) {
        if (typeof k === "string" && k !== "constructor") log.push(k);
        return t[k];
      },
    }),
  text: () => "ab",
  number: () => 5,
  nothing: () => null,
  missing: () => undefined,
};
const names = ["forEach", "every", "some", "find", "findIndex", "filter", "map", "reduce", "findLast", "flatMap"];
const callbacks = {
  yes: () => true,
  no: () => false,
  self: x => x,
  seen: (x, i, a) => {
    log.push(String(i));
    return i < 1;
  },
  grow: (x, i, a) => {
    if (Array.isArray(a) && a.length < 6 && !Object.isFrozen(a)) a.push(x);
    return true;
  },
  shrink: (x, i, a) => {
    if (Array.isArray(a) && !Object.isFrozen(a)) a.length = Math.min(a.length, 2);
    return true;
  },
  widen: (x, i, a) => {
    if (Array.isArray(a) && !Object.isFrozen(a) && i === 0 && a.length > 1) a[1] = "w";
    return x;
  },
  hole: (x, i, a) => {
    if (Array.isArray(a) && !Object.isFrozen(a) && a.length < 9) delete a[i + 1];
    return x;
  },
  thrown: () => {
    throw new RangeError("r");
  },
  own: function (x) {
    return this === undefined ? "u" : this.v;
  },
  number: 5,
  nothing: null,
  text: "f",
  boolean: Boolean,
  numberOf: Number,
  abs: Math.abs,
};
for (let r = 0; r < 2; r++)
  for (const [ln, l] of Object.entries(lists))
    for (const m of names)
      for (const [cn, c] of Object.entries(callbacks)) {
        if (
          (ln === "sparse" || ln === "long") &&
          !["thrown", "number", "nothing", "text"].includes(cn) &&
          !(ln === "sparse" && cn === "yes" && (m === "some" || m === "find"))
        )
          continue;
        t(ln + m + cn, () => {
          const a = l(),
            f = hide(Array.prototype[m]);
          const v = f.call(a, hide(c), { v: 3 });
          return [
            v === a ? "same" : v,
            Array.isArray(a) && a.length < 500 ? a : 0,
            Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype,
          ];
        });
      }
t("noArguments", () => hide([1, 2]).map());
t("lengthOf", () => names.map(n => Array.prototype[n].length + Array.prototype[n].name));
t("emptyMany", () => {
  let s = 0;
  const e = hide([]);
  for (let i = 0; i < 1000; i++) {
    e.forEach(() => s++);
    s += e.filter(Boolean).length + e.map(x => x).length;
  }
  return s;
});
let h = 7;
for (const s of out) for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
console.log(out.length, h, out.slice(0, 10).join("|"), out.slice(-3).join("|"));
