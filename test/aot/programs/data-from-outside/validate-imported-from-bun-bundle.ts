// validate<T>(value) is recognized by its import binding: an alias works, and a parameter, local, function or method with the same name is ordinary code.
// IR+ ^layout L\d+ .*name="User" .* representation=Typed
import type { Schema } from "bun";
interface User { id: number & Schema.Int; name: string }
function shown(call: () => unknown): string {
  try {
    return JSON.stringify(call());
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}
const above = (value: unknown): User => validate<User>(value);
import { validate, validate as check } from "bun:bundle";

console.log("validate", shown(() => validate<User>({ id: 1, name: "a", more: true })), shown(() => validate<User>({ id: 1.5, name: "a" })));
console.log("with an alias", shown(() => check<User>({ id: 2, name: "b" })), shown(() => check<User>({ id: 2 })));
console.log("called above the import", shown(() => above({ id: 3, name: "c" })), shown(() => above(null)));

function withParameter(validate: <T>(value: unknown) => T): string {
  return validate<string>(1);
}
console.log(withParameter(<T,>(value: unknown) => ("given " + value) as T));

function withLocal(): string {
  const check = <T,>(value: unknown) => ("a local given " + value) as T;
  return check<string>(2);
}
console.log(withLocal());

{
  function validate<T>(value: unknown): T {
    return ("a function in a block given " + value) as T;
  }
  console.log(validate<string>(3));
}

const holder = { validate: <T,>(value: unknown) => ("a method given " + value) as T };
console.log(holder.validate<string>(4));

const user = validate<User>({ id: 4, name: "d" });
console.log(user.id + 1, user.name.length);
