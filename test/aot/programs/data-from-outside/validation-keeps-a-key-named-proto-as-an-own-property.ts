// An undeclared key named "__proto__" in the data stays an own property of what JSON.parse<T>() and validate<T>() return. It never becomes the prototype, so it cannot supply a value for an optional property that the data left out.
import { JSON } from "bun";
import { validate } from "bun:bundle";
interface User { name: string; isAdmin?: boolean }
interface Bag { [key: string]: number | { isAdmin: boolean } }
interface Holder { user: User; users: User[] }
type Either = { kind: "a"; name: string; isAdmin?: boolean } | { kind: "b"; size: number };
const plain: any = globalThis.JSON;
function show(label: string, made: any): void {
  console.log(label, JSON.stringify(made), "isAdmin:", made.isAdmin, "own keys:", Object.getOwnPropertyNames(made).join(), "prototype is Object.prototype:", Object.getPrototypeOf(made) === Object.prototype);
}
const text = '{"name":"x","__proto__":{"isAdmin":true}}';
show("JSON.parse<User>", JSON.parse<User>(text));
show("validate<User>", validate<User>(plain.parse(text)));
show("with a reviver", JSON.parse<User>(text, (key, value) => value));
show("JSON.parse<Bag>", JSON.parse<Bag>('{"a":1,"__proto__":{"isAdmin":true}}'));
show("validate<Bag>", validate<Bag>(plain.parse('{"a":1,"__proto__":{"isAdmin":true}}')));
show("JSON.parse<Holder>.user", JSON.parse<Holder>('{"user":' + text + ',"users":[' + text + "]}").user);
show("validate<Holder>.users[0]", validate<Holder>(plain.parse('{"user":' + text + ',"users":[' + text + "]}")).users[0]);
show("JSON.parse<Either>", JSON.parse<Either>('{"kind":"a","name":"x","__proto__":{"isAdmin":true}}'));
show("validate<Either>", validate<Either>(plain.parse('{"kind":"a","name":"x","__proto__":{"isAdmin":true}}')));
show("JSON.parse<any>", JSON.parse<any>(text));
show("validate<unknown>", validate<unknown>(plain.parse(text)));
console.log("Object.prototype is clean:", ({} as any).isAdmin === undefined);
