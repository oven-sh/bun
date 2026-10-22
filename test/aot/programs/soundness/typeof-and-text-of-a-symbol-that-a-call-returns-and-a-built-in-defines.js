// typeof, String and description of a property into which Object.defineProperty stored the symbol that a call returns.
function make() { return Symbol("dog"); }
const holder = {};
Object.defineProperty(holder, "pet", { value: make(), writable: true, enumerable: true, configurable: true });
console.log(typeof holder.pet); console.log(String(holder.pet)); console.log(holder.pet.description);
