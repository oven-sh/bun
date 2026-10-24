// `import { JSON } from "bun"` is an object of its own. JSON.parse<T>(text) validates; every other member is the global's.
// IR+ ^layout L\d+ .*name="User" .* representation=Typed
import { JSON, JSON as Codec, type Schema } from "bun";
interface User { id: number & Schema.Int; name: string }
function shown(call: () => unknown): string {
  try {
    return JSON.stringify(call());
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}
console.log("JSON", shown(() => JSON.parse<User>('{"id":1,"name":"a","more":true}')), shown(() => JSON.parse<User>('{"id":1.5,"name":"a"}')));
console.log("with an alias", shown(() => Codec.parse<User>('{"name":"b","id":2}')), shown(() => Codec.parse<User>('{"id":2}')));
console.log("Bun.JSON", shown(() => Bun.JSON.parse<User>('{"id":3,"name":"c"}')), shown(() => Bun.JSON.parse<User>("null")));
console.log("with a reviver", shown(() => JSON.parse<User>('{"id":"4","name":"d"}', (key, value) => (key === "id" ? Number(value) : value))));
console.log("invalid JSON", shown(() => JSON.parse<User>('{"id":')).split(":")[0]);
console.log("any", shown(() => JSON.parse<any>('{"id":"5"}')), shown(() => Codec.parse<unknown>("[6]")));
console.log("another object", JSON === globalThis.JSON, Codec === JSON, Bun.JSON === JSON, JSON.stringify === globalThis.JSON.stringify);
console.log("other members", JSON.stringify({ a: [1] }), Codec.stringify("b"), JSON[Symbol.toStringTag], typeof JSON.parse);
console.log("as a value", ["7", "8"].map(text => JSON.parse<number>(text)).join(), (codec => codec.stringify([9]))(JSON), [JSON].length);

function withParameter(JSON: { parse<T>(text: string): T }): string {
  return JSON.parse<string>("1");
}
console.log(withParameter({ parse: <T,>(text: string) => ("theirs given " + text) as T }));

const user = JSON.parse<User>('{"id":10,"name":"j"}');
console.log(user.id + 1, user.name.length);
