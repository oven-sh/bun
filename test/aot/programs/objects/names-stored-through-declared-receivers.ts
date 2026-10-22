// One class makes the objects, the program sees them through interfaces and fills them from functions of their own, as a compiler fills its types, symbols and links.
// The receivers are in hands the compiler cannot follow, so only their declared types name the class. Whether a name gets a field, a slot out of line or an extra property, the object behaves the same:
// reads of what is absent, `in`, the order of keys, deletion, stores of values that the declared type does not admit, and names stored through a receiver without a type.
interface TypeLike {
  flags: number;
  id?: number;
  symbol?: string;
  widened?: TypeLike;
}
interface ObjectLike extends TypeLike {
  objectFlags: number;
  members?: Map<string, number>;
  properties?: string[];
}
interface Links {
  resolvedType?: TypeLike;
  resolvedName?: string;
  isVisible?: boolean;
  count?: number;
}

class Made {
  flags: number;
  constructor(flags: number) {
    this.flags = flags;
  }
}
const LinksMade = class implements Links {};

const hand = new Function("value", "return value") as <T>(value: T) => T;
const constructors = hand({ type: Made, links: LinksMade });

let nextId = 0;
function createType(flags: number): TypeLike {
  const result: TypeLike = new constructors.type(flags);
  result.id = ++nextId;
  return result;
}
function createTypeWithSymbol(flags: number, symbol: string): TypeLike {
  const result = createType(flags);
  result.symbol = symbol;
  return result;
}
function createObjectType(objectFlags: number, symbol: string): ObjectLike {
  const type = createTypeWithSymbol(8, symbol) as ObjectLike;
  type.objectFlags = objectFlags;
  type.members = undefined;
  type.properties = undefined;
  return type;
}
function resolveMembers(type: ObjectLike) {
  if (!type.members) {
    type.members = new Map([[type.symbol ?? "?", type.id ?? -1]]);
    type.properties = [...type.members.keys()];
  }
  return type.members;
}

const linksOf: Links[] = [];
function getLinks(id: number): Links {
  return (linksOf[id] ??= new constructors.links());
}

function show(label: string, object: object) {
  const listed: string[] = [];
  for (const name in object) listed.push(name);
  console.log(label, "|", Object.keys(object).join(), "|", listed.join(), "|", JSON.stringify(object, (_, value) => (value instanceof Map ? [...value] : value)));
}

const plain = hand(createType(1));
const named = hand(createTypeWithSymbol(2, "named"));
const object = hand(createObjectType(16, "object"));
const other = hand(createObjectType(32, "other"));
show("plain", plain);
show("named", named);
show("object", object);
console.log("id" in plain, "symbol" in plain, plain.symbol, "objectFlags" in plain, (plain as ObjectLike).objectFlags);
console.log("members" in object, object.members, Object.hasOwn(object, "properties"), "widened" in object, object.widened);

resolveMembers(object);
resolveMembers(object);
show("object resolved", object);
show("other unresolved", other);

named.widened = plain;
plain.widened = plain;
console.log(named.widened === plain, plain.widened === plain, Object.keys(named).join(), Object.keys(plain).join());

// The order of keys is the order of the stores, whatever the order of the fields.
const late = hand(createType(4)) as ObjectLike;
late.properties = ["p"];
late.symbol = "late";
late.objectFlags = 1;
show("late", late);
delete late.symbol;
show("late without symbol", late);
late.symbol = "again";
show("late with symbol again", late);

// Values that the declared types do not admit, and names that no type declares.
const loose: any = hand(createObjectType(64, "loose"));
loose.id = "a string";
loose.objectFlags = { boxed: true };
loose.members = 7;
loose.extra = "extra";
loose[Symbol.for("mark")] = 1;
show("loose", loose);
console.log(typeof loose.id, typeof loose.objectFlags, loose.members + 1, loose.extra, Object.getOwnPropertySymbols(loose).length);
Object.defineProperty(loose, "symbol", { get: () => "from a getter", enumerable: true, configurable: true });
console.log(loose.symbol, (loose as TypeLike).symbol, Object.getOwnPropertyDescriptor(loose, "symbol")!.get !== undefined);

for (let id = 0; id < 6; id++) {
  const links = getLinks(id);
  if (id % 2) links.resolvedType = id % 3 ? object : plain;
  if (id % 3 === 0) links.resolvedName = "n" + id;
  if (id === 4) links.isVisible = false;
  links.count = (links.count ?? 0) + id;
}
getLinks(4).count! += 10;
for (let id = 0; id < 6; id++) {
  const links = hand(getLinks(id));
  console.log(id, Object.keys(links).join(), links.resolvedType?.id, links.resolvedName, links.isVisible, links.count, "isVisible" in links);
}

// Many objects, so that the fields are filled by compiled code again and again, and a sum that depends on each of them.
let sum = 0;
const kept: TypeLike[] = [];
for (let index = 0; index < 20000; index++) {
  const type = index % 3 ? createObjectType(index, "s" + (index % 7)) : createTypeWithSymbol(index, "t");
  if (index % 5 === 0) type.widened = kept[index >> 1] ?? type;
  if (index % 3 === 1) resolveMembers(type as ObjectLike);
  kept.push(hand(type));
}
for (const type of kept) {
  const seen = type as ObjectLike;
  sum += (type.id ?? 0) + type.flags + (seen.objectFlags ?? 1) + (seen.members?.size ?? 2) + (seen.properties?.length ?? 3) + (type.widened ? type.widened.flags : 4) + Object.keys(type).length;
}
console.log(sum);
