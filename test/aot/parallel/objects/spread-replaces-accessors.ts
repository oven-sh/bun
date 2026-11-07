// Spread defines properties: an accessor of the literal is replaced by an own property of the source with the same key, also when the key is `__proto__`.
class Fields { ["__proto__"] = 2; a = 3 }
function describe(object: object): string {
  const properties = Reflect.ownKeys(object).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return String(key) + "=" + (descriptor && "value" in descriptor ? descriptor.value : "accessor");
  });
  return properties.join() + (Object.getPrototypeOf(object) === Object.prototype ? "" : " with another prototype");
}
function overProto(source: object): object { return { get __proto__() { return 1 }, ...source } }
function overA(source: object): object { return { get a() { return 1 }, ...source } }
function overBoth(source: object): object { return { get __proto__() { return 1 }, set a(value: number) {}, b: 0, ...source } }
function withoutA(source: any): object { const { a, ...rest } = source; return rest }

const sources: [string, () => object][] = [
  ["class instance", () => new Fields()],
  ["class instance with an added property", () => Object.assign(new Fields(), { added: 4 })],
  ["literal", () => ({ ["__proto__"]: 2, a: 3 })],
  ["parsed object", () => JSON.parse('{"__proto__":2,"a":3}')],
];
for (const [name, create] of sources) {
  for (let round = 0; round < 3; round++)
    console.log(name, "|", describe(overProto(create())), "|", describe(overA(create())), "|", describe(overBoth(create())), "|", describe(withoutA(create())));
}
