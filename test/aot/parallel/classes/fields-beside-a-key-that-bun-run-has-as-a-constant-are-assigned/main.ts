// @ts-nocheck
// Where fields are assigned ("useDefineForClassFields": false), a key in brackets whose value `bun run` has does not make the class define its fields.
// Until then one such key defined them all: `name!: string` overwrote what the parent's constructor had stored, in silence, and setters above did not run.
const KEY = "kind";
const log: string[] = [];
class Model {
  constructor(row?: object) {
    Object.assign(this, row);
  }
}
class User extends Model {
  ["ki" + "nd"] = "user";
  name!: string;
  age?: number;
}
const user = new User({ name: "Ann", age: 3 });
console.log(user.name, user.age, Object.keys(user).join());
for (const name of ["y", "kind", "ab", "3", "first-b", "4", "x"]) {
  Object.defineProperty(Model.prototype, name, {
    set(value) {
      log.push(name + "<" + value);
    },
    configurable: true,
  });
}
const tell = (label: string, made: object) =>
  console.log(label, log.splice(0).join() || "none", Object.keys(made).join() || "no keys", "optional" in made);
// prettier-ignore
{
  tell("constant", new (class extends Model { [KEY] = 1; y = 2; optional?: number; })());
  tell("sum", new (class extends Model { ["a" + "b"] = 1; y = 2; optional?: number; })());
  tell("numbers", new (class extends Model { [1 + 2] = 1; y = 2; optional?: number; })());
  tell("template", new (class extends Model { [`first-${"b"}`] = 1; y = 2; optional?: number; })());
  tell("length", new (class extends Model { ["abcd".length] = 1; y = 2; optional?: number; })());
  tell("asserted", new (class extends Model { [KEY as string] = 1; y = 2; optional?: number; })());
  tell("behind what nobody takes", new (class extends Model { [([], "x")] = 1; y = 2; optional?: number; })());
  tell("picked by what nobody takes", new (class extends Model { [[...[1]] ? "x" : "z"] = 1; y = 2; optional?: number; })());
}
export {};
