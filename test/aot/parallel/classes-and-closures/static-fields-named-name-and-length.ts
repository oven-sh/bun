// Static fields named `name` and `length` replace the properties every function has: they keep their values when the class is frozen, take a value of another type, give way to Function.prototype when deleted, and are listed with the other static fields, also after the last one is deleted.
function attempt(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function attributes(target: object, key: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) return `${key} absent`;
  return `${key} ${JSON.stringify(descriptor.value)} ${descriptor.writable ? "w" : "-"}${descriptor.enumerable ? "e" : "-"}${descriptor.configurable ? "c" : "-"}`;
}

function list(target: object): string {
  return `keys ${Object.keys(target).join()} | own keys ${Reflect.ownKeys(target).map(String).join()}`;
}

function enumerate(target: object): string {
  const names: string[] = [];
  for (const name in target) names.push(name);
  return `for-in ${names.join()} | entries ${JSON.stringify(Object.entries(target))} | own keys ${Reflect.ownKeys(target).map(String).join()}`;
}

class Listed {
  static a = 1;
  static name = "x";
  static length = 5;
}
console.log("listed first:", list(Listed));
console.log("read:", Listed.a, Listed.name, Listed.length);
console.log("described:", attributes(Listed, "a"), attributes(Listed, "name"), attributes(Listed, "length"));
console.log("entries:", JSON.stringify(Object.entries(Listed)), JSON.stringify({ ...Listed }));
console.log("bound:", Listed.bind(null).name, Listed.bind(null).length);

class Read {
  static a = 1;
  static name = "x";
  static length = 5;
}
console.log("read first:", Read.a, Read.name, Read.length, list(Read));

class Frozen {
  static a = 1;
  static name = "x";
  static length = 5;
}
Object.freeze(Frozen);
console.log("frozen:", Frozen.name === "x", Frozen.length === 5, Frozen.a === 1, Object.isFrozen(Frozen));
console.log("frozen:", attributes(Frozen, "a"), attributes(Frozen, "name"), attributes(Frozen, "length"), list(Frozen));
console.log(
  "stores to frozen:",
  attempt(() => (Frozen.name = "y")),
  attempt(() => (Frozen.length = 6)),
  attempt(() => (Frozen.a = 2)),
  attempt(() => delete (Frozen as any).name),
);
console.log("frozen:", Frozen.name, Frozen.length, Frozen.a);

class Sealed {
  static a = 1;
  static name = "x";
  static length = 5;
}
Object.seal(Sealed);
Sealed.name = "y";
Sealed.length = 6;
console.log("sealed:", Sealed.name, Sealed.length, attributes(Sealed, "name"), attributes(Sealed, "length"), list(Sealed));

class Stored {
  static a = 1;
  static name: string | number = "x";
  static length: string | number = 5;
  static read(): string {
    return `${typeof Stored.name} ${Stored.name}, ${typeof Stored.length} ${Stored.length}`;
  }
}
console.log("before the stores:", Stored.read());
Stored.name = 5;
Stored.length = "long";
console.log("another type:", Stored.name, Stored.length, Stored.read());
console.log("another type:", attributes(Stored, "name"), attributes(Stored, "length"), list(Stored));
console.log("another type, bound:", JSON.stringify(Stored.bind(null).name), Stored.bind(null).length);
Stored.name = "z";
Stored.length = 7;
console.log("first type again:", Stored.name, Stored.length, Stored.read(), list(Stored));

class NameDeleted {
  static a = 1;
  static name = "x";
  static length = 5;
}
console.log("delete name:", delete (NameDeleted as any).name, NameDeleted.name === "", JSON.stringify(NameDeleted.name), Object.hasOwn(NameDeleted, "name"));
console.log("delete name:", NameDeleted.a, NameDeleted.length, enumerate(NameDeleted));
console.log("store after delete:", attempt(() => (NameDeleted.name = "again")), JSON.stringify(NameDeleted.name), enumerate(NameDeleted));
Object.defineProperty(NameDeleted, "name", { value: "defined", writable: true, enumerable: true, configurable: true });
console.log("defined after delete:", NameDeleted.name, attributes(NameDeleted, "name"), list(NameDeleted));
NameDeleted.name = "stored";
console.log("stored after that:", NameDeleted.name, attributes(NameDeleted, "name"));

class NameDeletedBesideOneField {
  static a = 1;
  static name = "x";
}
console.log("delete name beside one field:", delete (NameDeletedBesideOneField as any).name, NameDeletedBesideOneField.name === "", NameDeletedBesideOneField.a, list(NameDeletedBesideOneField));

class LastDeleted {
  static a = 1;
  static name = "x";
  static length = 5;
}
console.log("delete the last field:", delete (LastDeleted as any).length, Object.keys(LastDeleted).join(), LastDeleted.length, list(LastDeleted));
console.log("delete the last field:", LastDeleted.a, LastDeleted.name, attributes(LastDeleted, "a"), attributes(LastDeleted, "name"));
console.log("delete the one before:", delete (LastDeleted as any).name, Object.keys(LastDeleted).join(), JSON.stringify(LastDeleted.name), list(LastDeleted));
console.log("delete the first:", delete (LastDeleted as any).a, Object.keys(LastDeleted).join(), LastDeleted.a, list(LastDeleted));

class OnlyField {
  static name = "x";
}
console.log("only field:", Object.keys(OnlyField).join(), delete (OnlyField as any).name, Object.keys(OnlyField).join(), JSON.stringify(OnlyField.name), list(OnlyField));

class DeletedThroughAlias {
  static a = 1;
  static name = "x";
  static length = 5;
  static b = 2;
}
const alias: any = [DeletedThroughAlias][0];
console.log("through an alias:", delete alias.b, Object.keys(alias).join(), delete alias.length, Object.keys(alias).join());
console.log("through an alias:", DeletedThroughAlias.a, DeletedThroughAlias.name, DeletedThroughAlias.length, DeletedThroughAlias.b, list(DeletedThroughAlias));
alias.b = 3;
console.log("added again:", DeletedThroughAlias.b, list(DeletedThroughAlias));

class Parent {
  static name = "parent";
  static length = 9;
}
class Child extends Parent {}
class ChildWithFields extends Parent {
  static name = "child";
}
console.log("inherited:", Child.name, Child.length, ChildWithFields.name, ChildWithFields.length, list(Child), "|", list(ChildWithFields));
console.log("inherited:", delete (ChildWithFields as any).name, ChildWithFields.name, delete (Child as any).name, Child.name, delete (Child as any).length, Child.length);

export {};
