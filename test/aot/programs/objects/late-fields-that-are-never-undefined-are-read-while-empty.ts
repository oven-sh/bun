// A field that is stored late, and never with undefined, is expected to be filled where it is read. A read that finds it empty, deleted, out of its slot, or answered from above the object is still right.
class Type {
  flags: number;
  constructor(flags: number) {
    this.flags = flags;
  }
}
interface ObjectFlagsType extends Type {
  objectFlags: number;
  target: Type;
  name: string;
}

function createObjectType(flags: number, objectFlags: number): ObjectFlagsType {
  const type = new Type(flags) as ObjectFlagsType;
  type.objectFlags = objectFlags;
  type.target = type;
  type.name = "type " + objectFlags;
  return type;
}

function getObjectFlags(type: Type): number {
  return type.flags & 1 ? (type as ObjectFlagsType).objectFlags : 0;
}
function readAnyway(type: Type) {
  return (type as ObjectFlagsType).objectFlags;
}
function targetOf(type: Type) {
  return (type as ObjectFlagsType).target;
}
function nameOf(type: Type) {
  return (type as ObjectFlagsType).name;
}
function allOf(type: Type) {
  const object = type as ObjectFlagsType;
  return `${object.objectFlags} ${object.target === type} ${object.name}`;
}

const filled: Type[] = [];
for (let index = 0; index < 2000; index++) filled.push(createObjectType(1, index));
let sum = 0;
for (const type of filled) sum += getObjectFlags(type) + readAnyway(type) + (targetOf(type) === type ? 1 : 0) + nameOf(type).length;
console.log("filled", sum);

const bare = new Type(0);
console.log("never stored", getObjectFlags(bare), readAnyway(bare), targetOf(bare), nameOf(bare), allOf(bare));

const lies = new Type(1);
console.log("flags say it is there", getObjectFlags(lies), allOf(lies));

const deleted = createObjectType(1, 7);
delete (deleted as any).objectFlags;
delete (deleted as any).target;
console.log("deleted", getObjectFlags(deleted), readAnyway(deleted), targetOf(deleted), nameOf(deleted), Object.keys(deleted).join());
deleted.objectFlags = 8;
console.log("stored again", getObjectFlags(deleted), Object.keys(deleted).join());

const accessor = createObjectType(1, 9);
let reads = 0;
Object.defineProperty(accessor, "objectFlags", { get() { return ++reads + 40; }, configurable: true });
console.log("accessor", getObjectFlags(accessor), readAnyway(accessor), allOf(accessor), reads);

const other = createObjectType(1, 10);
(other as any).objectFlags = "a string";
(other as any).target = 5;
(other as any).name = undefined;
console.log("other values", getObjectFlags(other), readAnyway(other), targetOf(other), nameOf(other), allOf(other));

const nulled = createObjectType(1, 11);
(nulled as any).objectFlags = null;
(nulled as any).target = null;
console.log("null", getObjectFlags(nulled), targetOf(nulled), allOf(nulled));

const frozen = Object.freeze(createObjectType(1, 12));
console.log("frozen", getObjectFlags(frozen), allOf(frozen));

const below = Object.create(createObjectType(1, 13)) as Type;
console.log("inherited from an object", getObjectFlags(below), readAnyway(below), nameOf(below));

const reparented = new Type(1);
Object.setPrototypeOf(reparented, { objectFlags: 14, name: "from above" });
console.log("another prototype", getObjectFlags(reparented), nameOf(reparented), targetOf(reparented));

(Type.prototype as any).objectFlags = 15;
(Type.prototype as any).name = "on the prototype";
console.log("on the prototype", getObjectFlags(bare), readAnyway(bare), getObjectFlags(lies), nameOf(lies), allOf(filled[3]), readAnyway(reparented));
Object.defineProperty(Type.prototype, "target", { get() { return "getter above " + this.flags; }, configurable: true });
console.log("getter above", targetOf(bare), targetOf(lies), targetOf(filled[4]) === filled[4], targetOf(deleted));
delete (Type.prototype as any).objectFlags;
delete (Type.prototype as any).name;
delete (Type.prototype as any).target;
console.log("gone again", readAnyway(bare), nameOf(lies), targetOf(bare), allOf(filled[5]));
