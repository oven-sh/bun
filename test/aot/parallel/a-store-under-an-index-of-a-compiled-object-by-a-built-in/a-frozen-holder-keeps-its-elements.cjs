// The holder is frozen: a store over an element that is there throws, and the element stays.
const bag = { length: 0 }; for (const item of JSON.parse('["x","y"]')) Array.prototype.push.call(bag, item);
Object.freeze(bag);
for (const item of JSON.parse('["a","b"]')) {
  let said = "stored";
  try { Array.prototype.fill.call(bag, item); } catch (error) { said = error.constructor.name; }
  console.log("SAID", said, Reflect.set(bag, 0, item), bag[0], bag[1], bag.length, Object.isFrozen(bag));
}
