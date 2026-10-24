// Data from outside is looked at as one type, and a function of another module returns it as a second type with the same properties. What is read out of it is used in typed code: joined to a string, put into a template, compared, stored in an array. Handing it on tests only that it is an object. A property that holds another kind than its type declares is found at the first typed read of it, which throws a TypeError; null and a missing property pass. A third module, the first to be compiled, casts between two types that hold these two, so the compiler has compared them before it comes to the return.
import { widen } from "./types";
import { load } from "./load";
import { pass } from "./pass";

const odd = pass(load('{"id":"seven","name":null,"more":true}'));
try {
  const joined = "id " + odd.id;
  console.log(joined, odd.id === 7, [odd.id, odd.name].length);
} catch (error) {
  console.log((error as Error).constructor.name);
}
const written = `name ${odd.name}`;
console.log(written, odd.name === "n", [odd.name].length);

const short = pass(load('{"id":8}'));
const sum = "" + short.id + short.name;
console.log(sum, typeof short.name);

const holder = widen({ held: { id: 4, name: "held" } });
console.log("" + holder.held.id + holder.held.name);
