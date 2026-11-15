// The holder had the elements 0 and 1; 0 is deleted: a hole. A setter for 0 lies above in the chain: the store runs the setter and the hole stays.
const heard = [];
const above = {}; Object.defineProperty(above, "0", { set(value) { heard.push(value); }, get() { return "above"; }, configurable: true });
const bag = Object.create(above); bag.length = 0;
Object.defineProperty(bag, "0", { value: "first", writable: true, enumerable: true, configurable: true });
bag[1] = "second";
delete bag[0];
for (const item of JSON.parse('["a","b","c"]')) {
  bag.length = 0;
  Array.prototype.push.call(bag, item);
  console.log("SAID", bag[0], bag[1], bag.length, JSON.stringify(heard), Object.keys(bag).join(), Object.hasOwn(bag, "0"));
}
