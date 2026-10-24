// Spread and rest in functions created from text at run time define properties: an own property of the source replaces an accessor of the literal with the same key and calls neither its getter nor its setter, also when the key is `__proto__`.
const marker = { inherited: true };
class Fields { ["__proto__"] = 2; a = 3 }
class Linked { ["__proto__"] = marker; a = 3 }

function describe(object: object): string {
  const properties = Reflect.ownKeys(object).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !("value" in descriptor)) return String(key) + "=accessor";
    const isOrdinary = descriptor.writable && descriptor.enumerable && descriptor.configurable;
    return String(key) + "=" + (descriptor.value === marker ? "marker" : descriptor.value) + (isOrdinary ? "" : " restricted");
  });
  const prototype = Object.getPrototypeOf(object);
  return properties.join() + (prototype === Object.prototype ? "" : prototype === null ? " without a prototype" : " with another prototype");
}

type Copy = (source: object, log: string[]) => object;
const createCopy = (body: string) => new Function("source", "log", body) as Copy;
const copies: [string, Copy][] = [
  ["alone", createCopy("return { ...source }")],
  ["before a member", createCopy("return { ...source, b: 0 }")],
  ["over a getter __proto__", createCopy("return { get __proto__() { log.push('get __proto__'); return 1 }, ...source }")],
  ["over a setter __proto__", createCopy("return { set __proto__(value) { log.push('set __proto__') }, ...source }")],
  ["over a getter a", createCopy("return { get a() { log.push('get a'); return 1 }, ...source }")],
  ["over a setter a", createCopy("return { set a(value) { log.push('set a') }, ...source }")],
  ["over both", createCopy("return { get __proto__() { log.push('get __proto__'); return 1 }, set a(value) { log.push('set a') }, b: 0, ...source }")],
  ["over an unrelated getter", createCopy("return { get c() { log.push('get c'); return 1 }, ...source }")],
  ["under a null prototype", createCopy("return { __proto__: null, ...source }")],
  ["rest without a", createCopy("var { a, ...rest } = source; return rest")],
  ["rest without __proto__", createCopy("var { __proto__: excluded, ...rest } = source; return rest")],
  ["rest without a computed __proto__", createCopy("var key = '__proto__'; var { [key]: excluded, ...rest } = source; return rest")],
];

const sources: [string, () => object][] = [
  ["class instance", () => new Fields()],
  ["class instance with an object value", () => new Linked()],
  ["class instance with an added property", () => Object.assign(new Fields(), { added: 4 })],
  ["class instance with a non-enumerable __proto__", () => Object.defineProperty(new Fields(), "__proto__", { enumerable: false })],
  ["class instance with a non-enumerable a", () => Object.defineProperty(new Fields(), "a", { enumerable: false })],
  ["frozen class instance", () => Object.freeze(new Fields())],
  ["literal", () => ({ ["__proto__"]: 2, a: 3 })],
  ["literal with an object value", () => ({ ["__proto__"]: marker, a: 3 })],
  ["parsed object", () => JSON.parse('{"__proto__":2,"a":3}')],
];

for (const [sourceName, createSource] of sources) {
  for (const [copyName, copy] of copies) {
    const rounds: string[] = [];
    for (let round = 0; round < 3; round++) {
      const log: string[] = [];
      rounds.push(describe(copy(createSource(), log)) + (log.length ? " called " + log.join() : ""));
    }
    console.log(sourceName, "|", copyName, "|", rounds.join(" | "));
  }
}
