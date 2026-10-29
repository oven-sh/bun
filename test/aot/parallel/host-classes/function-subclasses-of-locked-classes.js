// Subclasses of Request, Response, Blob, Headers, URL and URLSearchParams written with functions and prototypes, as code from before classes does: assigning `constructor` and methods to an object that inherits from a locked prototype behaves as in plain Bun.
const util = require("node:util");
const lines = [];
function say(label, work) {
  let text;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  lines.push(label + ": " + text);
}
const classes = [
  ["Request", Request, ["http://example.com/a"], "clone", "url"],
  ["Response", Response, ["body"], "clone", "status"],
  ["Blob", Blob, [["abc"]], "slice", "size"],
  ["Headers", Headers, [{ a: "1" }], "get", "count"],
  ["URL", URL, ["http://example.com/a"], "toJSON", "pathname"],
  ["URLSearchParams", URLSearchParams, ["a=1"], "get", "size"],
];
for (const [name, Base, args, method, getter] of classes) {
  say(name + ": Object.create, then constructor and a method are assigned", () => {
    function Sub() {
      return Reflect.construct(Base, args, Sub);
    }
    Sub.prototype = Object.create(Base.prototype);
    Sub.prototype.constructor = Sub;
    Sub.prototype[method] = function () {
      return "assigned";
    };
    Sub.prototype.extra = 1;
    const made = new Sub();
    return [made.constructor === Sub, Object.hasOwn(Sub.prototype, "constructor"), made[method](), made.extra, made instanceof Base, Base.prototype.constructor === Base, typeof made[getter]];
  });
  say(name + ": util.inherits", () => {
    function Sub() {}
    util.inherits(Sub, Base);
    Sub.prototype[method] = () => "inherited and replaced";
    return [Object.getPrototypeOf(Sub.prototype) === Base.prototype, Sub.super_ === Base, Sub.prototype[method](), Sub.prototype.constructor === Sub];
  });
  say(name + ": Object.setPrototypeOf(Sub.prototype, Base.prototype)", () => {
    function Sub() {}
    Object.setPrototypeOf(Sub.prototype, Base.prototype);
    Object.setPrototypeOf(Sub, Base);
    Sub.prototype.toString = () => "sub";
    return [String(Sub.prototype), Sub.prototype.constructor === Sub, Object.getPrototypeOf(Sub) === Base];
  });
  say(name + ": an instance's constructor, method and toString are assigned", () => {
    const made = new Base(...args);
    made.constructor = 1;
    made[method] = 2;
    made.toString = () => "own";
    made[Symbol.toStringTag] = "Own";
    return [made.constructor, made[method], String(made), Object.prototype.toString.call(made), Object.keys(made)];
  });
  say(name + ": the descriptor of constructor", () => {
    const { value, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(Base.prototype, "constructor");
    return [value === Base, typeof writable, enumerable, typeof configurable];
  });
  say(name + ": Object.freeze, Object.seal and Object.preventExtensions of the prototype", () => [
    Object.freeze(Base.prototype) === Base.prototype,
    Object.seal(Base.prototype) === Base.prototype,
    Object.preventExtensions(Base.prototype) === Base.prototype,
    Object.isFrozen(Base.prototype),
    Object.isSealed(Base.prototype),
  ]);
  say(name + ": after that, subclasses and instances still work", () => {
    class Sub extends Base {
      [method]() {
        return "overridden";
      }
    }
    const made = new Sub(...args);
    made.own = 1;
    return [made[method](), made.own, made instanceof Base];
  });
}
console.log(lines.join("\n"));
