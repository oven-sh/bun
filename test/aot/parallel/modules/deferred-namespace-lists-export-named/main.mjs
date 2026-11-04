// A deferred namespace object of a module that exports `then`: the name is among all own keys, and is no property.
import defer * as later from "./exports-then.mjs";
console.log("main begins");
console.log(typeof later.then, Reflect.has(later, "then"), Object.getOwnPropertyDescriptor(later, "then"));
console.log("not evaluated yet");
console.log(JSON.stringify(Object.getOwnPropertyNames(later)));
console.log(Reflect.ownKeys(later).map(String).join());
console.log(JSON.stringify(Object.keys(later)));
console.log(JSON.stringify(Object.entries(later)), JSON.stringify(Object.values(later)), JSON.stringify({ ...later }));
const walked = [];
for (const key in later) walked.push(key);
console.log(walked.join());
console.log(Object.keys(Object.getOwnPropertyDescriptors(later)).join());
console.log(JSON.stringify(Object.assign({}, later)), JSON.stringify(later));
console.log(typeof later.then, "then" in later, Object.hasOwn(later, "then"), Reflect.deleteProperty(later, "then"));
