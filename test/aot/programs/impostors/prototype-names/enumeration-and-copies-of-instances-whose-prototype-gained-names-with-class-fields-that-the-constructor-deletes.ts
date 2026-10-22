// What lists or copies properties must tell own ones from inherited ones: Object.keys, entries, for-in, JSON.stringify, spread, Object.assign, rest patterns,
// structuredClone, getOwnPropertyNames, hasOwnProperty, propertyIsEnumerable. The prototype gains an enumerable value, a hidden value and an enumerable getter.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Part {
  declare id: number;
  a?: number;
  b?: number;
  c?: number;
  constructor(id: number) {
    delete this.a;
    delete this.b;
    delete this.c;
    handOver(this);
    this.id = id;
  }
}
function forIn(part: Part) {
  const names: string[] = [];
  for (const name in part) names.push(name);
  return names.join();
}
function ownForIn(part: Part) {
  const names: string[] = [];
  for (const name in part) if (Object.prototype.hasOwnProperty.call(part, name)) names.push(name);
  return names.join();
}
function survey(part: Part) {
  const { id, ...rest } = part;
  const { a = "no a", b = "no b", c = "no c" } = part as any;
  return [
    "keys " + Object.keys(part),
    "entries " + JSON.stringify(Object.entries(part)),
    "for-in " + forIn(part),
    "own for-in " + ownForIn(part),
    "json " + JSON.stringify(part),
    "spread " + JSON.stringify({ ...part }),
    "assign " + JSON.stringify(Object.assign({}, part)),
    "rest " + JSON.stringify(rest) + id,
    "defaults " + [a, b, c],
    "clone " + JSON.stringify(structuredClone(part)),
    "names " + Object.getOwnPropertyNames(part),
    "own " + [part.hasOwnProperty("a"), part.hasOwnProperty("b"), part.hasOwnProperty("c")],
    "enumerable " + [part.propertyIsEnumerable("a"), part.propertyIsEnumerable("b"), part.propertyIsEnumerable("c")],
    "in " + ["a" in part, "b" in part, "c" in part],
    "values " + [part.a, part.b, part.c],
  ].join("; ");
}

let length = 0;
for (let i = 0; i < 1500; i++) {
  const part = new Part(i & 3);
  if (i & 1) part.b = 1;
  if (i & 2) part.a = 2;
  length += survey(part).length;
}
console.log("warm", length);

const empty = new Part(1);
const mixed = new Part(2);
mixed.c = 30;
mixed.a = 10;
console.log("before | empty:", survey(empty));
console.log("before | mixed:", survey(mixed));
const holder = Object.getPrototypeOf(empty);
holder[["a"][0]] = 100;
Object.defineProperty(holder, "b", { value: 200, enumerable: false, writable: true, configurable: true });
Object.defineProperty(holder, "c", {
  get(this: Part) {
    return this.id + 300;
  },
  enumerable: true,
  configurable: true,
});
console.log("gained | empty:", survey(empty));
console.log("gained | mixed:", survey(mixed));
console.log("gained | new:", survey(new Part(3)));
empty.b = 20;
console.log("b stored | empty:", survey(empty));
delete holder.a;
delete holder.b;
delete holder.c;
console.log("lost | empty:", survey(empty));
console.log("lost | mixed:", survey(mixed));
