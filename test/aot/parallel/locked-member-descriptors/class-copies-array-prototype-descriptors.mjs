// A class copies every descriptor of Array.prototype onto its own prototype and stores the length of its instances, as mixins of array methods do.
class Bag {
  constructor(...items) {
    this.length = 0;
    for (const item of items) this.push(item);
  }
}
for (const key of Reflect.ownKeys(Array.prototype)) {
  if (key !== "constructor") Object.defineProperty(Bag.prototype, key, Object.getOwnPropertyDescriptor(Array.prototype, key));
}
const bag = new Bag(3, 1, 2);
console.log(bag.length, bag.join(), bag.map(x => x * 2).join(), [...bag].join(), bag.indexOf(2), bag.pop(), bag.length);
Object.defineProperty(Bag.prototype, "join", { value() { return "joined"; } });
console.log(bag.join(), delete Bag.prototype.indexOf, "indexOf" in bag);
