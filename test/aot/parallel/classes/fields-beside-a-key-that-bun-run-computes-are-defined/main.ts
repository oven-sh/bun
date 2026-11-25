// @ts-nocheck
// The other side: a key that `bun run` computes at run time makes the class define all its fields, with "useDefineForClassFields": false too.
const SUM = "a" + "b";
enum Numbers {
  one = 21,
}
const log: string[] = [];
class Model {}
for (const name of ["y", "ab", "x", "21", "null", "true"]) {
  Object.defineProperty(Model.prototype, name, {
    set(value) {
      log.push(name + "<" + value);
    },
    configurable: true,
  });
}
const tell = (label: string, made: object) =>
  console.log(label, log.splice(0).join() || "none", Object.keys(made).join() || "no keys", "optional" in made);
let soft = "x";
console.log("late");
const LATE = "x";
// prettier-ignore
{
  tell("a constant that is a sum", new (class extends Model { [SUM] = 1; y = 2; optional?: number; })());
  tell("a late constant", new (class extends Model { [LATE] = 1; y = 2; optional?: number; })());
  tell("a let", new (class extends Model { [soft] = 1; y = 2; optional?: number; })());
  tell("a symbol", new (class extends Model { [Symbol.toStringTag] = "T"; y = 2; optional?: number; })());
  tell("a call", new (class extends Model { [String("x")] = 1; y = 2; optional?: number; })());
  tell("a member of an enum", new (class extends Model { [Numbers.one] = 1; y = 2; optional?: number; })());
  tell("null", new (class extends Model { [null] = 1; y = 2; optional?: number; })());
  tell("a boolean", new (class extends Model { [true] = 1; y = 2; optional?: number; })());
  tell("beside a variable", new (class extends Model { ["a" + "b"] = 1; [soft] = 2; y = 3; optional?: number; })());
}
export {};
