// The element 0 of the holder may not be written, beside an ordinary element 1: a store under 0 throws and it stays.
const bag = { length: 0 }; bag[1] = "second";
Object.defineProperty(bag, "0", { value: "fixed", writable: false, enumerable: true, configurable: true });
for (const item of JSON.parse('["a","b"]')) {
  bag.length = 0;
  let said = "stored";
  try { Array.prototype.push.call(bag, item); } catch (error) { said = error.constructor.name; }
  console.log("SAID", said, Reflect.set(bag, 0, item), Reflect.set(bag, 1, item), bag[0], bag[1], bag.length);
}
