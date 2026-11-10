// Under: --aot-testing=EmittersAloneTestEveryPosition: the walk and its proofs as users build, every position tested where it is used: a store that is told inside and is not stops by name.
function fill(v) { let said = ""; for (let i = 0; i + 2 < v.length; i += 3) { try { v[i] = i + 10; v[i + 1] = i + 11; v[i + 2] = i + 12; } catch (error) { said += error.constructor.name + ";"; } } return said + JSON.stringify(Array.from(v)); }
const seen = [];
class Heir extends Array {}
Object.defineProperty(Heir.prototype, 1, { set(value) { seen.push(value); }, get() { return "got"; }, configurable: true });
const heir = new Heir(); heir.length = 7; heir[0] = 1;
for (const make of [() => Object.freeze([1, 2, 3, 4, 5, 6, 7]), () => Object.seal([1, 2, 3, 4, 5, 6, 7]), () => Object.preventExtensions([1, , 3, , 5, , 7]), () => [1, 2, 3, 4, 5, 6, 7], () => [1.5, , 3.5, 4.5, , 6.5]])
  console.log(fill(make()));
console.log(fill(heir), seen.join());
