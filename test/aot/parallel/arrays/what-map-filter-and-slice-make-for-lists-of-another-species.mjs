// A list as its class makes it gets a new list without a call of the run time. Every other receiver asks for its species.
import vm from "node:vm";
class Mine extends Array { tag() { return "mine"; } }
class Plain extends Array { static get [Symbol.species]() { return Array; } }
function describe(list) { return [Object.getPrototypeOf(list) === Array.prototype ? "Array" : list.constructor && list.constructor.name, list.length, JSON.stringify(list), Object.keys(list).join("")].join(":"); }
function all(list) {
  const out = [];
  for (const make of [l => l.map(x => x * 2), l => l.filter(x => x > 1), l => l.slice(1), l => l.concat([9]), l => l.flat(), l => l.flatMap(x => [x, x]), l => l.splice(0, 1)]) {
    try { out.push(describe(make(list))); } catch (error) { out.push(error.name + ": " + error.message); }
  }
  return out.join(" ");
}
console.log(all([1, 2, 3]));
console.log(all([]));
console.log(all([1, , 3]));
console.log(all([1.5, 2.5]));
console.log(all(["a", {}]));
console.log(all(Mine.from([1, 2, 3])));
console.log(all(Plain.from([1, 2, 3])));
const own = [1, 2, 3]; own.constructor = Mine; console.log(all(own));
const none = [1, 2, 3]; none.constructor = undefined; console.log(all(none));
const bad = [1, 2, 3]; bad.constructor = 5; console.log(all(bad));
const odd = [1, 2, 3]; odd.constructor = { [Symbol.species]: function (n) { return { made: n, length: 0 }; } }; console.log(all(odd));
const nul = [1, 2, 3]; nul.constructor = { [Symbol.species]: null }; console.log(all(nul));
const moved = [1, 2, 3]; Object.setPrototypeOf(moved, Mine.prototype); console.log(all(moved));
const bare = [1, 2, 3]; Object.setPrototypeOf(bare, null); console.log(describe(Array.prototype.map.call(bare, x => x)));
const named = [1, 2, 3]; named.extra = 1; console.log(all(named));
const frozen = Object.freeze([1, 2, 3]); console.log(describe(frozen.map(x => x)), describe(frozen.filter(x => x > 1)));
console.log(describe(Array.prototype.map.call({ length: 2, 0: "a", 1: "b" }, x => x + x)), describe(Array.prototype.filter.call("abc", x => x > "a")));
const foreign = vm.runInNewContext("[1, 2, 3]"); const mapped = Array.prototype.map.call(foreign, x => x); console.log(mapped instanceof Array, Array.isArray(mapped), mapped.length);
const big = new Array(100000).fill(1); console.log(big.map(x => x).length, big.filter(x => x).length);
let grew = [1, 2, 3]; console.log(describe(grew.map((x, i, l) => { if (i === 0) l.push(9); return x; })));
