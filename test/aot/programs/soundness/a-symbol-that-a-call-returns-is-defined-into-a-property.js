// Object.defineProperty stores the symbol that a call returns, and a member is read from what the property holds.
function make() { return Symbol("dog"); }
const holder = {};
Object.defineProperty(holder, "pet", { value: make(), writable: true, enumerable: true, configurable: true });
console.log(holder.pet.legs);
