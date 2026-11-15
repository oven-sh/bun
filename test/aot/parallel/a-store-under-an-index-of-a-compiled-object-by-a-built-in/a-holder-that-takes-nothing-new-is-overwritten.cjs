// The holder is not extensible: an element that is there is overwritten; a new one is refused.
const bag = { length: 0 }; for (const item of JSON.parse('["x","y"]')) Array.prototype.push.call(bag, item);
Object.preventExtensions(bag);
for (const item of JSON.parse('["a","b"]')) {
  Array.prototype.fill.call(bag, item);
  let said = "stored";
  try { Array.prototype.push.call(bag, item); } catch (error) { said = error.constructor.name; }
  console.log("SAID", said, bag[0], bag[1], bag[2], bag.length, Object.keys(bag).join(), Object.isExtensible(bag));
  bag.length = 2;
}
