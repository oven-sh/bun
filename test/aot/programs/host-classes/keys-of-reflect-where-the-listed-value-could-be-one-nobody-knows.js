// Reads a member of Reflect where only a test takes the value. What is copied and listed is Reflect, out of a variable that could also hold a member of the global object.
if (!Reflect.set) console.log("none");
let object = Reflect;
if (Date.now() < 5) object = globalThis[String(Date.now())];
const entries = Object.entries(object);
console.log(entries.length, Reflect.ownKeys(object).map(String).join());
