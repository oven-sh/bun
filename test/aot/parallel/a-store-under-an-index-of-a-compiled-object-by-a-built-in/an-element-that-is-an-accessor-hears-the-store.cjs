// The element 0 of the holder is an accessor beside an ordinary element 1: a store under 0 runs its setter.
const heard = [];
const bag = { length: 0 }; bag[1] = "second";
Object.defineProperty(bag, "0", { set(value) { heard.push(value); }, get() { return "got"; }, enumerable: true, configurable: true });
for (const item of JSON.parse('["a","b","c"]')) {
  bag.length = 0;
  Array.prototype.push.call(bag, item);
  Array.prototype.push.call(bag, item + item);
  console.log("SAID", bag[0], bag[1], bag.length, JSON.stringify(heard));
}
