// Object.getOwnPropertyDescriptor on objects of classes and record types, whose fields are not stored as ordinary values: the parts read from a descriptor that is never made are what the descriptor object holds.
// CALLS- describe operationAOTGetOwnPropertyDescriptor\b
// CALLS+ describeByObject operationAOTGetOwnPropertyDescriptor\b
class Base {
  id: number;
  parent: Base | undefined = undefined;
  constructor(id: number) {
    this.id = id;
  }
}
class Leaf extends Base {
  readonly text: string;
  flag: boolean;
  ratio: number;
  maybe?: number;
  either: string | number;
  list: number[];
  nothing: null = null;
  constructor(id: number, text: string) {
    super(id);
    this.text = text;
    this.flag = id % 2 === 0;
    this.ratio = id / 4;
    this.either = id % 3 ? text : id;
    this.list = [id];
  }
  get upper(): string {
    return this.text.toUpperCase();
  }
}
type Row = { name: string; count: number; next?: Row };

function show(value: unknown): string {
  if (typeof value === "object" && value !== null) return value instanceof Base ? "Base " + value.id : JSON.stringify(value);
  return String(value);
}
// Each has a loop, so that it counts as warm, and is called through an array, so that it stays a function.
function describe(object: object, key: PropertyKey): string {
  let result = "";
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return "none";
    result = [show(descriptor.value), descriptor.writable, descriptor.enumerable, descriptor.configurable, typeof descriptor.get, typeof descriptor.set].join(" ");
  }
  return result;
}
function describeByObject(object: object, key: PropertyKey): string {
  let result = "";
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return "none";
    const copy: PropertyDescriptor = Object.assign({}, descriptor);
    result = [show(copy.value), copy.writable, copy.enumerable, copy.configurable, typeof copy.get, typeof copy.set].join(" ");
  }
  return result;
}
const ways = [describe, describeByObject];

const root = new Base(0);
const objects: object[] = [root];
for (let i = 1; i <= 6; i++) {
  const leaf = new Leaf(i, "t" + i);
  leaf.parent = i % 2 ? root : undefined;
  if (i % 3 === 0) leaf.maybe = i * 1.5;
  objects.push(leaf);
}
const first: Row = { name: "first", count: 1 };
const second: Row = { name: "second", count: 2, next: first };
objects.push(first, second, Object.freeze(new Leaf(7, "frozen")), Object.seal(new Leaf(8, "sealed")), Object.freeze({ name: "f", count: 3 } as Row));
const extended: any = new Leaf(9, "extended");
extended.extra = "more";
Object.defineProperty(extended, "ratio", { enumerable: false });
Object.defineProperty(extended, "computed", { get: () => 1, configurable: true });
objects.push(extended);

let differences = 0;
for (let round = 0; round < 3; round++)
  for (const object of objects)
    for (const key of [...Reflect.ownKeys(object), "upper", "missing", "maybe", "next"]) {
      const taken = ways[0]!(object, key);
      if (taken !== ways[1]!(object, key)) differences++;
      if (round === 2) console.log(show(object), String(key), ":", taken);
    }
console.log("differences", differences);
