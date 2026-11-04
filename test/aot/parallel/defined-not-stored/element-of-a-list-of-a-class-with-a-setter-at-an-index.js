class List extends Array {}
Object.defineProperty(List.prototype, "0", { set(value) { console.log("the setter ran"); }, configurable: true });
const made = List.of("the element");
console.log(made[0], Object.hasOwn(made, "0"), made.length);
const mapped = made.map(value => value + "!");
console.log(mapped[0], mapped instanceof List);
