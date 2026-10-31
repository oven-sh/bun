// A spread, a rest pattern and Object.assign read the own enumerable properties of a source in order. An object that has had a getter, or a value that the host makes at the first read,
// is read as any other once its enumerable properties are plain; one that still has an enumerable getter runs it at its place, and sees what the getters in front of it did.
const lines: string[] = [];
const log = (line: string) => void lines.push(line);
const show = (name: string, value: object) => log(name + " | " + JSON.stringify(value) + " | " + Reflect.ownKeys(value).map(String).join(","));
type Anything = Record<string | symbol, unknown>;

function sameAsEnvironment(name: string, copy: Record<string, string | undefined>) {
  const keys = Object.keys(process.env);
  const copied = Object.keys(copy);
  log(name + " | keys " + (keys.length === copied.length && keys.every((key, index) => key === copied[index])) + " | values " + keys.every(key => process.env[key] === copy[key]));
}
const mine = (copy: Record<string, string | undefined>) => Object.keys(copy).filter(key => key.startsWith("COPIED_")).map(key => key + "=" + copy[key]).join(" ");

for (let round = 0; round < 3; round++) sameAsEnvironment("environment, round " + round, { ...process.env });
process.env.COPIED_FIRST = "1";
process.env.COPIED_SECOND = "two";
for (let round = 0; round < 2; round++) { const copy = { ...process.env }; sameAsEnvironment("two more", copy); log(mine(copy)); }
process.env.COPIED_NUMBER = 3 as unknown as string;
delete process.env.COPIED_FIRST;
for (let round = 0; round < 2; round++) { const copy = { ...process.env, COPIED_LAST: "last" }; log(mine(copy)); }
process.env.COPIED_FIRST = "again";
process.env.TZ = "UTC";
process.env["7"] = "seven";
for (let round = 0; round < 2; round++) { const copy: Record<string, string | undefined> = { COPIED_SECOND: "replaced", ...process.env }; sameAsEnvironment("with TZ and an index", copy); log(mine(copy) + " | " + copy.TZ + " | " + copy["7"] + " | " + Object.keys(copy)[0]); }
delete process.env["7"];
{
  const { COPIED_SECOND, TZ, ...rest } = process.env;
  log("rest | " + COPIED_SECOND + " | " + TZ + " | " + mine(rest) + " | " + ("TZ" in rest));
  const assigned: Record<string, string | undefined> = Object.assign({}, process.env);
  sameAsEnvironment("assigned", assigned);
  const onto: Record<string, string | undefined> = Object.assign({ COPIED_FIRST: "before", OTHER: "kept" }, process.env);
  log("assigned onto | " + mine(onto) + " | " + onto.OTHER);
}
const copyOfCopy = { ...{ ...process.env } };
copyOfCopy.COPIED_SECOND = "only in the copy";
log("the source keeps its own | " + process.env.COPIED_SECOND);

function onceHadGetter(): Anything {
  const object: Anything = { a: 1, b: 2 };
  Object.defineProperty(object, "c", { get() { log("getter of c"); return 3; }, enumerable: true, configurable: true });
  object.d = 4;
  return object;
}
{
  const object = onceHadGetter();
  show("getter", { ...object });
  show("getter, again", { z: 0, ...object });
  Object.defineProperty(object, "c", { value: 30, writable: true, enumerable: true, configurable: true });
  show("now a value", { ...object });
  show("now a value, again", { z: 0, ...object, d: 5 });
  const { a, ...rest } = object;
  show("rest " + a, rest);
  show("assigned", Object.assign({ c: "before" }, object));
}
{
  const object: Anything = { a: 1 };
  Object.defineProperty(object, "hidden", { get() { log("THE HIDDEN GETTER RAN"); return 0; }, enumerable: false, configurable: true });
  object.b = 2;
  Object.defineProperty(object, "fixed", { value: 9, enumerable: true });
  Object.defineProperty(object, "unseen", { value: 8, enumerable: false });
  show("a hidden getter", { ...object });
  show("a hidden getter, again", { ...object, a: 10 });
  const copy: Anything = { ...object };
  copy.fixed = 90;
  show("the copy of a fixed value may be written", copy);
}
{
  const object: Anything = { a: 1 };
  Object.defineProperty(object, "b", { get() { log("b deletes c, adds e, writes d"); delete object.c; object.e = 5; object.d = 40; return 2; }, enumerable: true, configurable: true });
  object.c = 3;
  object.d = 4;
  show("a getter that changes its object", { ...object });
  show("and what is left", { ...object });
}
{
  const key = Symbol("key"), other = Symbol("other");
  const object: Anything = { [key]: 1, a: 2 };
  Object.defineProperty(object, "g", { get() { return 0; }, enumerable: true, configurable: true });
  delete object.g;
  object[other] = 3;
  object.b = 4;
  show("symbols among names", { ...object });
  show("symbols among names, behind others", { b: 0, [other]: 0, ...object });
  const { a, [key]: taken, ...rest } = object;
  show("rest " + String(a) + String(taken), rest);
}
{
  const many: Anything = {};
  for (let i = 0; i < 100; i++) many["name" + i] = i;
  for (let i = 0; i < 100; i += 3) delete many["name" + i];
  many.name0 = "back";
  const copy: Anything = { ...many };
  log("many | " + Object.keys(copy).length + " | " + Object.keys(copy).slice(0, 3).join(",") + " | " + Object.keys(copy).at(-1) + " | " + Object.keys(many).every(name => many[name] === copy[name]));
  Object.defineProperty(many, "name1", { get() { return "got"; }, enumerable: true, configurable: true });
  const second: Anything = { first: true, ...many };
  log("many, one getter | " + Object.keys(second).length + " | " + String(second.name1) + " | " + Object.keys(second).slice(0, 3).join(","));
}
{
  class Holder { plain = 1; static made = 0; get computed() { return 2; } }
  const holder = new Holder() as unknown as Anything;
  Object.defineProperty(holder, "own", { get() { log("own getter of an instance"); return 3; }, enumerable: true, configurable: true });
  show("an instance", { ...holder });
  Object.defineProperty(holder, "own", { value: 30, enumerable: true, configurable: true, writable: true });
  show("an instance, now a value", { ...holder });
  const list = Object.assign([1, 2], { name: "list" });
  show("a list with a name", { ...list });
  const fn = Object.assign(function named() {}, { extra: 1 }) as unknown as Anything;
  show("a function with a name of its own", { ...fn });
  const proto: Anything = { ["__proto__"]: 1, a: 2 };
  show("a name __proto__", { ...proto });
  log(String(Object.getPrototypeOf({ ...proto }) === Object.prototype));
}
console.log(lines.join("\n"));
