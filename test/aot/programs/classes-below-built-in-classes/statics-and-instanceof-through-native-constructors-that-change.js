class NotFound extends Error {}
class Forbidden extends Error {}
class Bag extends Map {}
class List extends Array {}
class Later extends Promise {}

function kindOf(thrower) {
  try {
    thrower();
  } catch (error) {
    return error instanceof NotFound ? 404 : error instanceof Forbidden ? 403 : error instanceof Error ? 500 : 0;
  }
  return -1;
}
const notFound = new NotFound("a");
const forbidden = new Forbidden("b");
const throwers = [
  () => {
    throw notFound;
  },
  () => {
    throw forbidden;
  },
  () => {
    throw new RangeError("c");
  },
  () => {
    throw "text";
  },
];
function round() {
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += kindOf(throwers[i & 3]);
  return sum;
}
function statics(name) {
  const found = [];
  for (const constructor of [NotFound, Forbidden, Bag, List, Later]) {
    let seen;
    for (let i = 0; i < 50; i++) seen = constructor[name];
    found.push(typeof seen === "function" ? "function " + seen.name : seen);
  }
  return found;
}
const lines = [round(), statics("extra"), statics("isArray"), statics("resolve"), statics("captureStackTrace"), statics("groupBy")];

Error.extra = "on Error";
Map.extra = "on Map";
lines.push(statics("extra"));
delete Error.extra;
lines.push(statics("extra"));
Object.defineProperty(Array, "extra", { get() { return "by a getter of " + this.name; }, configurable: true });
lines.push(statics("extra"));
delete Array.extra;
lines.push(statics("extra"));

NotFound.extra = 1;
lines.push(statics("extra"), Object.hasOwn(Error, "extra"));

Object.defineProperty(NotFound, Symbol.hasInstance, { value: value => value === forbidden, configurable: true });
lines.push(round());
delete NotFound[Symbol.hasInstance];
lines.push(round());
Object.setPrototypeOf(Forbidden, NotFound);
Object.defineProperty(NotFound, Symbol.hasInstance, { value: () => false, configurable: true });
lines.push(round());
delete NotFound[Symbol.hasInstance];
lines.push(round());
console.log(JSON.stringify(lines));
