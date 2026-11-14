// What stands under the name is no leaf, reads `this`, takes the index and the list, takes none, has a default, a rest list, reads `arguments`, throws, calls the chain again, is async, a generator, a class, a bound function, a method read off an object, a built-in.
const rows = JSON.parse("[1,2,3,4]");
const said = [];
function helper(value) { return value + 1; }
function noLeaf(value) { return helper(helper(value)); }
function readsThis(value) { return value * this.by; }
function takesAll(value, index, list) { return value + index * 10 + list.length * 100; }
function takesNone() { return 7; }
function hasDefault(value, index = 5, other = 9) { return value + index + (typeof other); }
function hasRest(...all) { return all.length; }
function readsArguments() { return arguments.length + arguments[0]; }
function throwsAtThree(value) { if (value === 3) throw new RangeError("three"); return value; }
function again(value) { return rows.map(helper).reduce(plus, value); }
function plus(total, value) { return total + value; }
async function later(value) { return value; }
function* steps(value) { yield value; }
class Box { constructor(value) { this.value = value; } }
function big(value) { return value > 2; }
const bound = readsThis.bind({ by: 3 });
const holder = { by: 4, method(value) { return value * (this ? this.by : -1); } };
for (let turn = 0; turn < 3; turn++) {
  said.length = 0;
  said.push(rows.map(noLeaf).filter(big).join(), rows.map(readsThis, { by: 2 }).join(), rows.map(takesAll).join(), rows.map(takesNone).join(), rows.map(hasDefault).join(), rows.map(hasRest).join(), rows.map(readsArguments).join(), rows.map(again).join());
  try { rows.map(throwsAtThree); } catch (error) { said.push(error.message); }
  try { rows.map(readsThis); } catch (error) { said.push(error.constructor.name); }
  try { rows.map(Box); } catch (error) { said.push(error.constructor.name); }
  said.push(rows.map(later).length, typeof rows.map(later)[0].then, rows.map(steps).map(it => it.next().value).join(), rows.map(bound).join(), rows.map(holder.method, holder).join());
  said.push(rows.map(String).join(""), rows.map(Number).reduce(plus, 0), [0, 1, "", "a", null].filter(Boolean).join(), ["1", "2", "3"].map(parseInt).join(), rows.map(Math.sqrt).filter(Number.isInteger).join(), rows.reduce(Math.max), [[1], 2].filter(Array.isArray).length);
  console.log(said.join(" | "));
}
