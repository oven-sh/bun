// A literal typed by an interface, and an instance of a class, have an empty declared slot and are the prototypes of other objects: heirs made by Object.create, one and two levels down,
// and the prototype of another class. The heirs are asked for the name thousands of times and do not find it. Then typed code fills the slot, which changes no shape and tells nobody; then it deletes it again.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
interface Shape {
  id: number;
  hint?: string;
  size?: number;
}
class Model implements Shape {
  id: number;
  hint?: string;
  size?: number;
  constructor(id: number) {
    this.id = id;
    delete this.hint;
    delete this.size;
    handOver(this);
  }
}
class Below {
  declare own: number;
  declare hint?: string;
  constructor() {
    this.own = 1;
  }
}
function setHint(shape: Shape, value: string) {
  shape.hint = value;
}
function dropHint(shape: Shape) {
  delete shape.hint;
}
function setSize(shape: Shape, value: number) {
  shape.size = value;
}
function byName(object: any) {
  return object.hint;
}
function byKey(object: any, key: string) {
  return object[key];
}
function isIn(object: object) {
  return "hint" in object;
}
function walk(object: object) {
  const names: string[] = [];
  for (const name in object) names.push(name);
  return names.join();
}
function typedBelow(below: Below) {
  return below.hint;
}
function ask(objects: object[]) {
  return objects.map(object => `${byName(object)} ${byKey(object, "hint")} ${isIn(object)} ${Reflect.get(object, "hint")} (${walk(object)})`).join(" | ");
}
function literal(id: number): Shape {
  const made: Shape = { id };
  handOver(made);
  return made;
}

for (const [label, parent] of [["a literal", literal(1)], ["an instance", new Model(2)]] as [string, Shape][]) {
  const heir = Object.create(parent);
  const heirOfHeir = Object.create(heir);
  heirOfHeir.mine = true;
  const family = [parent, heir, heirOfHeir];
  let misses = 0;
  for (let i = 0; i < 3000; i++) for (const object of family) if (byName(object) === undefined && byKey(object, "hint") === undefined && !isIn(object)) misses++;
  for (let i = 0; i < 300; i++) misses += walk(heirOfHeir).length;
  console.log(label, "| misses", misses);
  console.log(label, "| empty:", ask(family));
  setHint(parent, "filled");
  console.log(label, "| filled:", ask(family));
  setSize(parent, 3);
  console.log(label, "| a second field:", ask(family), heirOfHeir.size);
  dropHint(parent);
  console.log(label, "| deleted:", ask(family));
  setHint(parent, "again");
  console.log(label, "| filled again:", ask(family));
  heir.hint = "of the heir";
  dropHint(parent);
  console.log(label, "| the heir has its own:", ask(family));
  delete heir.hint;
  console.log(label, "| nobody has it:", ask(family));
}

const above = literal(3);
let length = 0;
for (let i = 0; i < 3000; i++) length += typedBelow(new Below())?.length ?? 1;
Object.setPrototypeOf(Below.prototype, above);
const old = new Below();
for (let i = 0; i < 3000; i++) length += (typedBelow(old)?.length ?? 1) + (byName(old)?.length ?? 1);
console.log("a class under a literal | misses", length, typedBelow(old), isIn(old), walk(old));
setHint(above, "from the literal above the class");
console.log("a class under a literal | filled:", typedBelow(old), typedBelow(new Below()), byName(old), isIn(old), walk(old));
dropHint(above);
console.log("a class under a literal | deleted:", typedBelow(old), typedBelow(new Below()), byName(old), isIn(old), walk(old));
