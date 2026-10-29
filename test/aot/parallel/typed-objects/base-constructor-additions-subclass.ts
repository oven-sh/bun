// The fields of a class that extends another are defined when `super()` has returned: whatever the constructor of the other class has created by then comes before them among the keys, for good.
const keysOf = (object: object): string => {
  const inherited: string[] = [];
  for (const key in object) inherited.push(key);
  return [Object.keys(object), Object.getOwnPropertyNames(object), Reflect.ownKeys(object), Object.entries(object).map(entry => entry[0]), Object.keys({ ...object }), Object.keys(Object.assign({}, object)), inherited].map(keys => keys.join()).join(" ");
};
class Model { id = 1; declare createdAt?: string; constructor() { this.createdAt = "today"; } }
class User extends Model { name = "u"; }
console.log(JSON.stringify(new User()), keysOf(new User()));
class Bound { n = 1; label: string; constructor(label: string) { this.label = label; this.who = this.who.bind(this); } who(): string { return this.label; } }
class HeirOfBound extends Bound { more = 2; }
console.log(keysOf(new Bound("b")), "|", keysOf(new HeirOfBound("h")), new HeirOfBound("h").who());
class Extra { n = 1; constructor() { (this as any).x = 1; } }
class HeirOfExtra extends Extra { more = 2; }
console.log(keysOf(new HeirOfExtra()), JSON.stringify(new HeirOfExtra()));
class Declared { n = 1; declare opt?: number; constructor() { this.opt = 1; } }
class HeirOfDeclared extends Declared { more = 2; }
console.log(keysOf(new HeirOfDeclared()), JSON.stringify(new HeirOfDeclared()));
class Arrow { n = 1; constructor() { this.m = () => 1; } m(): number { return 0; } }
class HeirOfArrow extends Arrow { more = 2; }
console.log(keysOf(new HeirOfArrow()), new HeirOfArrow().m());
class First { n = 1; constructor() { this.m = this.m.bind(this); } m(): number { return 0; } }
class Second extends First { more = 2; constructor() { super(); this.k = this.k.bind(this); } k(): number { return 1; } }
class Third extends Second { last = 3; }
console.log(keysOf(new Second()), "|", keysOf(new Third()));
class FieldsBehind { constructor() { this.m = this.m.bind(this); } m(): number { return 0; } n = 1; }
class HeirOfFieldsBehind extends FieldsBehind { more = 2; }
console.log(keysOf(new HeirOfFieldsBehind()));
class Optional { n = 1; opt?: number; constructor() { this.opt = 1; } }
class HeirOfOptional extends Optional { more = 2; }
console.log(keysOf(new HeirOfOptional()), JSON.stringify(new HeirOfOptional()));
let last = "";
for (let i = 0; i < 300; i++) last = keysOf(new Third()) + keysOf(new User()) + keysOf(new HeirOfExtra());
console.log(last);
