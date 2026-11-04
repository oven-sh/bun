// As the makers of a compiler's types do it: one constructor function, makers that add their own fields behind a cast, some of them undefined at first and filled later in another order.
interface Sym { name: string }
interface Type { flags: number; id: number; symbol: Sym | undefined }
interface ObjectType extends Type {
  objectFlags: number;
  members: Map<number, number> | undefined;
  properties: number[] | undefined;
  callSignatures: number | undefined;
  constructSignatures: string | undefined;
  indexInfos: number[] | undefined;
}
interface LiteralType extends Type { value: number | string; regularType: Type; freshType?: Type }
interface UnionType extends Type { types: Type[]; origin: Type | undefined; objectFlags: number; resolvedReducedType?: Type }
function Type(this: Type, flags: number) {
  this.flags = flags;
}
const allocator = { getTypeConstructor: () => Type as unknown as new (flags: number) => Type };
let count = 0;
function createType(flags: number): Type {
  const result = new (allocator.getTypeConstructor())(flags);
  result.id = ++count;
  return result;
}
function createObjectType(objectFlags: number, symbol: Sym | undefined): ObjectType {
  const type = createType(1) as ObjectType;
  type.symbol = symbol;
  type.objectFlags = objectFlags;
  type.members = undefined;
  type.properties = undefined;
  type.callSignatures = undefined;
  type.constructSignatures = undefined;
  type.indexInfos = undefined;
  return type;
}
function resolve(type: ObjectType, members: Map<number, number>, properties: number[]) {
  type.indexInfos = [type.id];
  type.members = members;
  type.constructSignatures = "none";
  type.properties = properties;
  type.callSignatures = type.id * 2;
  return type;
}
function createLiteralType(value: number | string, regular: Type | undefined): LiteralType {
  const type = createType(2) as LiteralType;
  type.value = value;
  type.regularType = regular || type;
  return type;
}
function createUnion(types: Type[]): UnionType {
  const type = createType(4) as UnionType;
  type.types = types;
  type.origin = undefined;
  type.objectFlags = types.length;
  return type;
}
const all: Type[] = [];
for (let i = 0; i < 60000; i++) {
  const object = createObjectType(i, i % 3 ? { name: "s" + i } : undefined);
  if (i % 2) resolve(object, new Map([[i, i]]), [i]);
  const literal = createLiteralType(i % 5 ? i : "t" + i, i % 4 ? undefined : object);
  const union = createUnion([object, literal]);
  if (i % 6 === 0) union.resolvedReducedType = object;
  if (i % 9 === 0) literal.freshType = union;
  if (i % 11 === 0) all.push(object, literal, union);
}
let sum = 0;
for (const type of all) {
  sum += type.flags + type.id;
  if (type.flags === 1) {
    const object = type as ObjectType;
    sum += object.objectFlags + (object.symbol ? object.symbol.name.length : 0);
    sum += object.members ? object.members.size + object.properties![0] + object.callSignatures! + object.constructSignatures!.length + object.indexInfos![0] : "members" in object ? 1 : 1000000;
  } else if (type.flags === 2) {
    const literal = type as LiteralType;
    sum += typeof literal.value === "number" ? literal.value : literal.value.length;
    sum += literal.regularType.id + (literal.freshType ? literal.freshType.id : 0);
  } else {
    const union = type as UnionType;
    sum += union.types.length + union.objectFlags + (union.resolvedReducedType ? union.resolvedReducedType.id : 0) + ("origin" in union ? 1 : 1000000);
  }
}
console.log(sum, Object.keys(all[0]).join(), Object.keys(all[1]).join(), Object.keys(all[2]).join(), Object.keys(all[3]).join());
