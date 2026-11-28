// A static field under a symbol that the module creates is listed, read, stored, deleted and redefined as any other.
const tag = Symbol("tag"), other = Symbol("other"), registered = Symbol.for("static-fields-under-created-symbols");
let order = "";
const note = (name, value) => ((order += name), value);
class Entity {
  static [note("a", tag)] = note("1", "entity");
  static plain = note("2", 5);
  static [note("b", registered)] = note("3", 7);
  [other] = 1;
  static bump() {
    Entity.plain = (Entity.plain + 1) | 0;
    Entity[registered] += 2;
    return Entity.plain + Entity[registered];
  }
}
class Column extends Entity {
  static [tag] = "column";
}
class Bare extends Entity {}
const is = (value, type) => {
  if (value instanceof type) return true;
  let above = Object.getPrototypeOf(value)?.constructor;
  while (above) {
    if (tag in above && above[tag] === type[tag]) return true;
    above = Object.getPrototypeOf(above);
  }
  return false;
};
console.log(order, Reflect.ownKeys(Entity).map(String).join(), Reflect.ownKeys(Column).map(String).join());
let sum = 0;
for (let i = 0; i < 1000; i++) sum = (sum + Entity.bump()) | 0;
console.log(sum, Entity.plain, Entity[registered], Column.plain, Column[registered], Column[tag], Bare[tag], Object.hasOwn(Bare, tag));
console.log(is(new Column(), Column), is(new Column(), Entity), is(new Bare(), Column), is({}, Entity));
Column[registered] = 1;
console.log(Column.bump(), Object.hasOwn(Column, registered), Column[registered], Entity[registered]);
Object.defineProperty(Entity, tag, { get: () => "by a getter", configurable: true });
console.log(Entity[tag], Bare[tag], Column[tag], delete Entity[tag], Entity[tag], Bare[tag]);
delete Column[tag];
console.log(Column[tag], tag in Column, Reflect.ownKeys(Entity).map(String).join());
Entity[tag] = "again";
console.log(Column[tag], Reflect.ownKeys(Entity).map(String).join(), JSON.stringify(Object.getOwnPropertyDescriptor(Entity, tag)));
function make(key) {
  return class { static [key] = key; static same = 1; };
}
const [first, second] = [make(tag), make("same")];
console.log(first[tag] === tag, first.same, second.same);
try {
  class Frozen { static [tag] = 1; static { Object.freeze(this); } static [other] = 2; }
  console.log(Frozen[other]);
} catch (error) {
  console.log(error.constructor.name);
}
