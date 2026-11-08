// Each line: the frames of the TypeError of `new f()`, where f is a function that is no constructor. A native function stands in a frame of its own above the caller.
function show(label, error) {
  const frames = String(error.stack).split("\n").slice(1, 5);
  const places = frames.map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/ ]+:\d+:\d+)\)?/, "$1"));
  console.log(
    label,
    "|",
    error.name,
    "|",
    String(error.message).replace(/ \(evaluating .*$/, ""),
    "|",
    places.join(" < "),
  );
}
function viaNew(f) {
  return new f(1n);
}
function viaSpread(f, list) {
  return new f(...list);
}
class Below extends Object {
  constructor() {
    super();
  }
}
const bound = Math.max.bind(null, 1);
const functions = [
  ["atob", require("node:buffer").atob],
  ["isAscii", require("node:buffer").isAscii],
  ["getFips", require("node:crypto").getFips],
  ["isDate", require("node:util").types.isDate],
  ["parseInt", parseInt],
  ["max", Math.max],
  ["push", [].push],
  ["bound", bound],
  ["bound arrow", (() => 1).bind(null)],
  ["arrow", () => 1],
  ["method", { m() {} }.m],
  ["async", async function () {}],
  ["generator", function* () {}],
  ["Symbol", Symbol],
  ["BigInt", BigInt],
  ["proxy", new Proxy(Math.max, {})],
  ["getter", Object.getOwnPropertyDescriptor(Map.prototype, "size").get],
  ["number", 1],
  ["nothing", undefined],
];
for (const [name, f] of functions) {
  try {
    viaNew(f);
    console.log(name, "| no error");
  } catch (error) {
    show(name, error);
  }
  try {
    viaSpread(f, [1, 2]);
    console.log(name, "spread | no error");
  } catch (error) {
    show(name + " spread", error);
  }
  try {
    Reflect.construct(f, []);
    console.log(name, "reflect | no error");
  } catch (error) {
    show(name + " reflect", error);
  }
  try {
    Reflect.construct(Object, [], f);
    console.log(name, "as new.target | no error");
  } catch (error) {
    show(name + " as new.target", error);
  }
}
try {
  new (require("node:buffer").atob)(1n);
} catch (error) {
  show("written atob", error);
}
try {
  new Math.max(1);
} catch (error) {
  show("written max", error);
}
try {
  new parseInt("1");
} catch (error) {
  show("written parseInt", error);
}
try {
  Object.setPrototypeOf(Below, parseInt);
  new Below();
} catch (error) {
  show("class above", error);
}
try {
  class A extends parseInt {}
  new A();
} catch (error) {
  show("extends", error);
}
