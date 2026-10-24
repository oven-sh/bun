console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

var log = [];
var makers = {
  open: () => ({ a: 1 }),
  frozen: () => Object.freeze({ a: 1 }),
  fixed: () => Object.defineProperty({}, "a", { value: 1, enumerable: true }),
  getterOnly: () => ({
    get a() {
      return 1;
    },
  }),
  inheritedFixed: () => Object.create(Object.freeze({ a: 1 })),
  inheritedGetterOnly: () =>
    Object.create({
      get a() {
        return 1;
      },
    }),
  inheritedSetter: () =>
    Object.create({
      set a(value) {
        log.push("setter " + value);
      },
      get a() {
        return 1;
      },
    }),
  closedWithoutA: () => Object.preventExtensions({}),
  refusingProxy: () => new Proxy({ a: 1 }, { set: () => false }),
  lyingProxy: () => new Proxy({ a: 1 }, { set: () => true }),
  functionName: () => function a() {},
  classInstance: () =>
    new (class {
      get a() {
        return 1;
      }
    })(),
};
var stores = {
  set: object => {
    object.a = 2;
    return object.a;
  },
  setComputed: object => {
    object["a".trim()] = 2;
    return object.a;
  },
  add: object => {
    object.a += 2;
    return object.a;
  },
  increment: object => [object.a++, object.a],
  logical: object => {
    object.a &&= 2;
    return object.a;
  },
  pattern: object => {
    ({ a: object.a } = { a: 2 });
    return object.a;
  },
  valueOfTheStore: object => (object.a = 2),
  name: object => {
    object.name = "renamed";
    return object.name;
  },
};
for (var i = 0; i < 2000; i++) for (var store in stores) stores[store]({ a: i, name: "n" });
for (var maker in makers) {
  for (var store in stores) {
    log.length = 0;
    attempt(store + "(" + maker + ")", stores[store].bind(null, makers[maker]()));
    if (log.length) console.log(store + "(" + maker + ") ran", log.join(", "));
  }
}
