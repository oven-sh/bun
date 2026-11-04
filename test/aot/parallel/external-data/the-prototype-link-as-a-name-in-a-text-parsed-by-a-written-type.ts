// A text has a member under `__proto__` and is parsed by a written type: the member is an own property, and the object stays below Object.prototype.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make
type Config = { port: number; host: string };
function load(text: string) { return JSON.parse(text) as Config; }
function show(c: Config) {
  return [JSON.stringify(c), Object.keys(c).join(), Object.getPrototypeOf(c) === Object.prototype, Object.hasOwn(c, "__proto__"), String(c.port), String(c.host)].join(" | ");
}
const texts = [
  '{"__proto__":{"port":1},"host":"a"}',
  '{"port":2,"host":"a","__proto__":null}',
  '{"port":3,"__proto__":{"host":"inherited"}}',
  '{"__proto__":[],"port":4,"host":"a"}',
  '{"port":5,"host":"a","__proto__":7}',
  '{"port":6,"host":"a","\\u005f_proto__":{"x":1}}',
];
for (let round = 0; round < 3; round++) {
  for (const text of texts) console.log(show(load(text)));
}
