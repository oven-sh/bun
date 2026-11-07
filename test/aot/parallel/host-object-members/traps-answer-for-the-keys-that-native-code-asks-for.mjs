// A get trap of a proxy answers for a key that native code asks an object for. The proxy is the object, or stands above it.
const answers = new Map([
  [Symbol.toPrimitive, function (hint) { return "prim:" + hint; }],
  [Symbol.toStringTag, "Tagged"],
  [Symbol.iterator, function* () { yield 1; yield new Map([[1, 2]]); }],
  ["then", function (resolve) { resolve(new Set(["thenable"])); }],
  ["toJSON", function (name) { return { json: String(name), at: new Date(0) }; }],
  ["constructor", class Named {}],
]);
const places = {
  itself: handler => new Proxy({}, handler),
  below: handler => Object.create(new Proxy({}, handler)),
  twoUp: handler => Object.create(Object.create(new Proxy({}, handler))),
  revocable: handler => Object.create(Proxy.revocable({}, handler).proxy),
};
const uses = {
  log: object => console.log(object),
  inside: object => console.log([object], { inner: object }),
  format: object => console.log("%o|%s|%j", object, object, object),
  string: object => console.log(String(object)),
  template: object => console.log(`${object}`),
  plus: object => console.log(object + "", +object),
  json: object => console.log(JSON.stringify(object), JSON.stringify({ inner: object })),
  awaited: async object => console.log(await object),
  resolved: object => Promise.resolve(object).then(value => console.log(value)),
  spread: object => console.log([...object]),
  forOf: object => { for (const value of object) console.log(value); },
  from: object => console.log(Array.from(object), new Set(object).size),
  tag: object => console.log(Object.prototype.toString.call(object)),
  equal: object => console.log(Bun.deepEquals(object, {})),
  clone: object => console.log(structuredClone(object)),
};
for (const [key, answer] of answers) {
  const handler = { get: (target, asked, receiver) => (asked === key ? answer : Reflect.get(target, asked, receiver)) };
  for (const [place, make] of Object.entries(places)) {
    for (const [use, run] of Object.entries(uses)) {
      console.log("--", String(key), place, use);
      try {
        await run(make(handler));
      } catch (error) {
        console.log("threw", error.name);
      }
    }
  }
}
