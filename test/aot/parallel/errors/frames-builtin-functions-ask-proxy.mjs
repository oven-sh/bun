// A trap of a proxy, a getter or the conversion of a key takes a stack trace or throws below a built-in function. Each row prints the frames down to `start`:
// their names, and for a built-in function what stands in the place of its file.
const framesOf = stack => {
  const frames = String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""))
    .map(frame =>
      frame.includes(" (") ? frame.replace(/\((native|unknown)?.*\)/, (place, word = "file") => `(${word})`) : "(file)",
    );
  const end = frames.findIndex(frame => frame.startsWith("start "));
  return frames.slice(0, end + 1).join(" < ");
};
let seen = "";
function look() {
  seen = framesOf(new Error().stack);
  return undefined;
}
function fail() {
  throw new RangeError("thrown below");
}
function start(run, act) {
  seen = "";
  try {
    const result = run(act);
    return seen + " | " + typeof result;
  } catch (error) {
    return error.name + ": " + error.message.replace(/ \(evaluating '.*'\)$/s, "") + " | " + framesOf(error.stack);
  }
}
const trapped = (name, act) =>
  new Proxy(
    { a: 1 },
    {
      [name](...all) {
        act();
        return Reflect[name](...all);
      },
    },
  );
const key = act => ({
  toString() {
    act();
    return "a";
  },
});
const got = act => ({
  get a() {
    act();
    return 1;
  },
});
const maybe = flag => (flag ? null : { a: 1 });
const rows = {
  describe: act => Object.getOwnPropertyDescriptor(trapped("getOwnPropertyDescriptor", act), "a"),
  describeUnused: act => {
    Object.getOwnPropertyDescriptor(trapped("getOwnPropertyDescriptor", act), "a");
  },
  describeValue: act => Object.getOwnPropertyDescriptor(trapped("getOwnPropertyDescriptor", act), "a").value,
  describeOptional: act => Object.getOwnPropertyDescriptor(trapped("getOwnPropertyDescriptor", act), "a")?.enumerable,
  describeKey: act => Object.getOwnPropertyDescriptor({ a: 1 }, key(act)),
  describeKeyValue: act => Object.getOwnPropertyDescriptor({ a: 1 }, key(act)).value,
  describeReturned(act) {
    return Object.getOwnPropertyDescriptor(trapped("getOwnPropertyDescriptor", act), "a");
  },
  describeNull: () => Object.getOwnPropertyDescriptor(null, "a"),
  describeNullValue: () => Object.getOwnPropertyDescriptor(null, "a").value,
  describeUndefined: () => Object.getOwnPropertyDescriptor(undefined, "a"),
  describeNumber: act => Object.getOwnPropertyDescriptor(1, key(act)),
  reflectDescribe: act => Reflect.getOwnPropertyDescriptor(trapped("getOwnPropertyDescriptor", act), "a"),
  reflectDescribeValue: act => Reflect.getOwnPropertyDescriptor(trapped("getOwnPropertyDescriptor", act), "a").value,
  reflectDescribeKey: act => Reflect.getOwnPropertyDescriptor({ a: 1 }, key(act)),
  reflectDescribeNumber: () => Reflect.getOwnPropertyDescriptor(1, "a"),
  reflectDescribeNumberValue: () => Reflect.getOwnPropertyDescriptor(1, "a").value,
  describeAll: act => Object.getOwnPropertyDescriptors(trapped("getOwnPropertyDescriptor", act)),
  describeAllKeys: act => Object.getOwnPropertyDescriptors(trapped("ownKeys", act)),
  values: act => Object.values(trapped("get", act)),
  valuesKeys: act => Object.values(trapped("ownKeys", act)),
  valuesDescribed: act => Object.values(trapped("getOwnPropertyDescriptor", act)),
  valuesGetter: act => Object.values(got(act)),
  valuesNull: () => Object.values(null),
  entries: act => Object.entries(trapped("get", act)),
  entriesKeys: act => Object.entries(trapped("ownKeys", act)),
  entriesGetter: act => Object.entries(got(act)),
  entriesNull: () => Object.entries(undefined),
  keys: act => Object.keys(trapped("ownKeys", act)),
  keysDescribed: act => Object.keys(trapped("getOwnPropertyDescriptor", act)),
  hasOwn: act => Object.hasOwn(trapped("getOwnPropertyDescriptor", act), "a"),
  hasOwnKept: act => {
    const kept = Object.hasOwn(trapped("getOwnPropertyDescriptor", act), "a");
    return [kept];
  },
  hasOwnInCondition: act => (Object.hasOwn(trapped("getOwnPropertyDescriptor", act), "a") ? 1 : 2),
  hasOwnOfWhatMayBeNull: () => Object.hasOwn(maybe(true), "a"),
  hasOwnOfWhatMayBeNullKept: () => {
    const kept = Object.hasOwn(maybe(true), "a");
    return [kept];
  },
  hasOwnKey: act => Object.hasOwn({ a: 1 }, key(act)),
  hasOwnNull: () => Object.hasOwn(null, "a"),
  hasOwnProperty: act => trapped("getOwnPropertyDescriptor", act).hasOwnProperty("a"),
  hasOwnPropertyCalled: act => Object.prototype.hasOwnProperty.call(trapped("getOwnPropertyDescriptor", act), "a"),
  hasOwnPropertyKey: act => ({ a: 1 }).hasOwnProperty(key(act)),
  hasOwnPropertyNull: () => Object.prototype.hasOwnProperty.call(null, "a"),
  isEnumerable: act => Object.prototype.propertyIsEnumerable.call(trapped("getOwnPropertyDescriptor", act), "a"),
  isEnumerableKey: act => ({ a: 1 }).propertyIsEnumerable(key(act)),
  isEnumerableNull: () => Object.prototype.propertyIsEnumerable.call(null, "a"),
  assign: act => Object.assign({}, trapped("get", act)),
  assignKeys: act => Object.assign({}, trapped("ownKeys", act)),
  assignGetter: act => Object.assign({}, got(act)),
  assignSet: act => Object.assign(trapped("set", act), { a: 2 }),
  assignSetter: act =>
    Object.assign(
      {
        set a(value) {
          act();
        },
      },
      { a: 2 },
    ),
  define: act => Object.defineProperty(trapped("defineProperty", act), "a", { value: 2 }),
  defineKey: act => Object.defineProperty({}, key(act), { value: 2 }),
  defineGetter: act =>
    Object.defineProperty({}, "a", {
      get value() {
        act();
        return 1;
      },
    }),
  reflectDefine: act => Reflect.defineProperty(trapped("defineProperty", act), "a", { value: 2 }),
  defineAll: act => Object.defineProperties(trapped("defineProperty", act), { a: { value: 2 } }),
  prototypeOf: act => Object.getPrototypeOf(trapped("getPrototypeOf", act)),
  reflectPrototypeOf: act => Reflect.getPrototypeOf(trapped("getPrototypeOf", act)),
  setPrototypeOf: act => Object.setPrototypeOf(trapped("setPrototypeOf", act), null),
  reflectSetPrototypeOf: act => Reflect.setPrototypeOf(trapped("setPrototypeOf", act), null),
  isPrototypeOf: act => Object.prototype.isPrototypeOf.call({}, trapped("getPrototypeOf", act)),
  isExtensible: act => Object.isExtensible(trapped("isExtensible", act)),
  reflectIsExtensible: act => Reflect.isExtensible(trapped("isExtensible", act)),
  preventExtensions: act => Object.preventExtensions(trapped("preventExtensions", act)),
  reflectPreventExtensions: act => Reflect.preventExtensions(trapped("preventExtensions", act)),
  freeze: act => Object.freeze(trapped("ownKeys", act)),
  isFrozen: act => Object.isFrozen(trapped("isExtensible", act)),
  seal: act => Object.seal(trapped("preventExtensions", act)),
  isSealed: act => Object.isSealed(trapped("isExtensible", act)),
  reflectGet: act => Reflect.get(trapped("get", act), "a"),
  reflectGetGetter: act => Reflect.get(got(act), "a"),
  reflectSet: act => Reflect.set(trapped("set", act), "a", 2),
  reflectSetSetter: act =>
    Reflect.set(
      {
        set a(value) {
          act();
        },
      },
      "a",
      2,
    ),
  reflectHas: act => Reflect.has(trapped("has", act), "a"),
  reflectOwnKeys: act => Reflect.ownKeys(trapped("ownKeys", act)),
  reflectApply: act =>
    Reflect.apply(
      new Proxy(function () {}, {
        apply() {
          act();
        },
      }),
      null,
      [],
    ),
  fromEntries: act =>
    Object.fromEntries([
      {
        get 0() {
          act();
          return "a";
        },
        1: 1,
      },
    ]),
  create: act => Object.create(null, trapped("ownKeys", act)),
  createGetter: act =>
    Object.create(null, {
      a: {
        get value() {
          act();
          return 1;
        },
      },
    }),
  groupBy: act => Object.groupBy([1], () => act()),
  objectToString: act =>
    Object.prototype.toString.call({
      get [Symbol.toStringTag]() {
        act();
        return "x";
      },
    }),
  toLocaleString: act =>
    ({
      toString() {
        act();
        return "";
      },
    }).toLocaleString(),
  isArray: act => Array.isArray(trapped("get", act)),
  spreadObject: act => ({ ...trapped("ownKeys", act) }),
  spreadGetter: act => ({ ...got(act) }),
  inOperator: act => "a" in trapped("has", act),
  structured: act => structuredClone(got(act)),
  stringify: act => JSON.stringify(trapped("get", act)),
  stringifyKeys: act => JSON.stringify(trapped("ownKeys", act)),
};
for (const [name, run] of Object.entries(rows)) {
  console.log(name, "looks:", start(run, look));
  console.log(name, "fails:", start(run, fail));
}
