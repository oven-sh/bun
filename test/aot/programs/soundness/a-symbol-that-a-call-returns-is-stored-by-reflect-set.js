// Reflect.set stores the symbol that a call returns, and a member is read from what the property holds.
function make() { return Symbol("dog"); }
const holder = {};
Reflect.set(holder, "pet", make());
console.log(holder.pet.legs);
