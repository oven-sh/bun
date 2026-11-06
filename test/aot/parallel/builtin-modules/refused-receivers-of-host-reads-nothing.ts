// Headers, URLSearchParams and their iterators refuse a receiver by the name of the class alone and read nothing of the receiver. Blob describes what it refuses.
const read: string[] = [];
function told(run: () => unknown): string {
  read.length = 0;
  let said: string;
  try {
    said = "answered " + String(run());
  } catch (error: any) {
    said = `${error.name} ${error.code}: ${error.message}`;
  }
  return `${said} | read: ${read.join(" ") || "nothing"}`;
}
const print = Symbol.for("nodejs.util.inspect.custom");
const noting = <Value>(name: string, value: Value): Value => (read.push(name), value);
const values: Record<string, any> = {
  "a getter for constructor": {
    get constructor() {
      return noting("constructor", Object);
    },
    a: 1,
  },
  "a class with a getter for its name": new (Object.defineProperty(
    class {
      x = 1;
    },
    "name",
    {
      get() {
        return noting("name", "Computed");
      },
    },
  ))(),
  "a method that prints it": {
    __proto__: null,
    [print]() {
      return noting("print", "printed");
    },
  },
  "a getter for its tag": {
    __proto__: null,
    get [Symbol.toStringTag]() {
      return noting("tag", "Tagged");
    },
  },
  "a getter for a field": {
    __proto__: null,
    get field() {
      return noting("field", 1);
    },
  },
  "a proxy": new Proxy(
    {},
    {
      get: (target, key) => noting("get:" + String(key), undefined),
      getPrototypeOf: () => noting("getPrototypeOf", null),
      ownKeys: () => noting("ownKeys", []),
      getOwnPropertyDescriptor: (target, key) => noting("describe:" + String(key), undefined),
    },
  ),
};
const methods: Record<string, Function> = {
  "Headers.get": Headers.prototype.get,
  "Headers.append": Headers.prototype.append,
  "Headers.forEach": Headers.prototype.forEach,
  "Headers.keys": Headers.prototype.keys,
  "Headers.toJSON": (Headers.prototype as any).toJSON,
  "next of Headers.keys": Object.getPrototypeOf(new Headers().keys()).next,
  "URLSearchParams.get": URLSearchParams.prototype.get,
  "URLSearchParams.sort": URLSearchParams.prototype.sort,
  "URLSearchParams.toString": URLSearchParams.prototype.toString,
  "URLSearchParams.entries": URLSearchParams.prototype.entries,
  "next of URLSearchParams.entries": Object.getPrototypeOf(new URLSearchParams().entries()).next,
  "Blob.text": Blob.prototype.text,
};
for (const [method, callee] of Object.entries(methods))
  for (const [kind, value] of Object.entries(values))
    console.log(`${method}, ${kind}: ${told(() => callee.call(value, "a", "b"))}`);

// The same receivers where the call names the method and the value is written on the spot.
console.log(
  told(() =>
    Headers.prototype.get.call(
      {
        get constructor() {
          return noting("constructor", Object);
        },
      } as any,
      "a",
    ),
  ),
);
console.log(
  told(() =>
    URLSearchParams.prototype.get.call(
      {
        __proto__: null,
        [print]() {
          return noting("print", "printed");
        },
      } as any,
      "a",
    ),
  ),
);
console.log(
  told(() =>
    Reflect.apply(
      Headers.prototype.has,
      {
        __proto__: null,
        get field() {
          return noting("field", 1);
        },
      },
      ["a"],
    ),
  ),
);

// An object below a prototype of the host, without a constructor, that has been where nobody sees and comes back.
const hidden: any[] = JSON.parse("[]");
for (const above of [Blob.prototype, Headers.prototype, URLSearchParams.prototype] as any[])
  hidden.push({
    __proto__: above,
    constructor: undefined,
    [print]() {
      return noting("print", "printed");
    },
  });
hidden.push({
  __proto__: { __proto__: null, text: Blob.prototype.text, get: Headers.prototype.get },
  [print]() {
    return noting("print", "printed");
  },
});
for (const back of hidden) {
  console.log(told(() => back.text?.()));
  console.log(told(() => back.get?.("a")));
}
