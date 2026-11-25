// Prints the names of classes without a name that have class decorators, where the language gives a name and Bun's transpiler writes none. Plain Bun prints another output.
// `||=`, `??=`, `&&=`, a parameter, a key in brackets, a private name, a number and the head of a `for` give their name: plain Bun says "" nine times.
const told: string[] = [];
function on(value: any, context: any) {
  told.push(String(context.name));
  return value;
}
let Or: any, Nullish: any, And: any = 1;
Or ||= @on class {};
Nullish ??= @on class {};
And &&= @on class {};
function take(Parameter = @on class {}) {
  return Parameter;
}
class Holder {
  static ["InBrackets"] = @on class {};
  static #hidden = @on class {};
  static 7 = @on class {};
  static read() {
    return Holder.#hidden;
  }
}
const record: any = { 1: @on class {} };
const kept: any[] = [];
for (const InHead = @on class {}; kept.length < 1; ) kept.push(InHead);
const names = (...values: any[]) => JSON.stringify(values.map(value => value.name));
console.log(names(Or, Nullish, And, take()));
console.log(names((Holder as any).InBrackets, Holder.read(), (Holder as any)[7], record[1], kept[0]));
console.log(JSON.stringify(told));
/* Output:
["Or","Nullish","And","Parameter"]
["InBrackets","#hidden","7","1","InHead"]
["Or","Nullish","And","InBrackets","#hidden","7","1","InHead","Parameter"]
*/
