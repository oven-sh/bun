// What the functions ask of the objects that they name is not what the published helpers ask.
import { d, lay } from "./helpers.ts";
var first = {};
d(first, { a: () => 1 });
var second = {};
lay(second, { a: () => 1 });
second.a = 5;
console.log(Object.keys(first), second.a);
