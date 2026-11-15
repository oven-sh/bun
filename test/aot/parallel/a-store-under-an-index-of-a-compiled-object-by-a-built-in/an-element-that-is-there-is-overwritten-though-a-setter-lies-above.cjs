// The holder has the element 0 of its own; a setter for 0 lies above in the chain: the own element is overwritten and the setter does not run.
const heard = [];
const above = {}; Object.defineProperty(above, "0", { set(value) { heard.push(value); }, get() { return "above"; }, configurable: true });
const bag = Object.create(above); bag.length = 0;
Object.defineProperty(bag, "0", { value: "first", writable: true, enumerable: true, configurable: true });
for (const item of JSON.parse('["a","b","c"]')) {
  bag.length = 0;
  Array.prototype.push.call(bag, item);
  console.log("SAID", bag[0], bag.length, JSON.stringify(heard), Object.keys(bag).join());
}
