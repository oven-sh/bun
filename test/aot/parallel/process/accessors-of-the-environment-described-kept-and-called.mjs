// Env: TZ=UTC
// process.env has accessors of native code under three names. What describes one holds its two functions, which are kept in fields, lists and variables, called, and laid on other objects.
const names = ["TZ", "NODE_TLS_REJECT_UNAUTHORIZED", "BUN_CONFIG_VERBOSE_FETCH"];

function keptInLiteral() {
  const description = Object.getOwnPropertyDescriptor(process.env, "TZ");
  return { get: description.get, set: description.set, value: description.value };
}
class Kept {
  constructor(description) {
    this.get = description.get;
    this.set = description.set;
  }
}
function keptInList() {
  const description = Reflect.getOwnPropertyDescriptor(process.env, "TZ");
  return [description.get, description.set];
}

const literal = keptInLiteral();
console.log(typeof literal.get, typeof literal.set, typeof literal.value, literal.get.length, literal.set.length);
const instance = new Kept(Object.getOwnPropertyDescriptor(process.env, "NODE_TLS_REJECT_UNAUTHORIZED"));
console.log(typeof instance.get, typeof instance.set);
console.log(
  keptInList()
    .map(each => typeof each)
    .join(),
);

let reached = 0;
function count() {
  return ++reached;
}
const description = Object.getOwnPropertyDescriptor(process.env, "TZ");
const get = description.get;
if (get !== undefined) count();
if (typeof get === "function") count();
if (get) count();
if (get instanceof Function) count();
if ("get" in description) count();
if (!("value" in description)) count();
console.log(reached, Object.keys(description).join());

console.log(literal.get.call(process.env), Reflect.apply(description.get, process.env, []));
literal.set.call(process.env, "Asia/Tokyo");
console.log(process.env.TZ, new Date(0).getHours());

for (const name of names) {
  const each = Object.getOwnPropertyDescriptor(process.env, name);
  console.log(name, typeof each.get, typeof each.set, each.configurable);
}

const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(process.env));
function zoneOf(object) {
  return object.TZ;
}
console.log(zoneOf(copy), zoneOf({ TZ: 1 }), typeof Object.getOwnPropertyDescriptor(copy, "TZ").get);

const other = { tag: 1 };
Object.defineProperty(other, "zone", Object.getOwnPropertyDescriptor(process.env, "TZ"));
console.log(typeof other.zone, other.tag, Object.keys(other).join());

class Zone {
  tag = 1;
}
Object.defineProperty(Zone.prototype, "zone", Object.getOwnPropertyDescriptor(process.env, "TZ"));
const zone = new Zone();
console.log(typeof zone.zone, zone.tag, Object.keys(zone).join());
