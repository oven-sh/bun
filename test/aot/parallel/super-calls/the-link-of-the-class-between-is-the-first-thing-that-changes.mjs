// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: SuperCallsDevirtualized >= 1
const words = JSON.parse('{"proto":"prototype","weigh":"weigh"}');
class Root { weigh(by) { return by; } }
class Middle extends Root {}
class Leaf extends Middle { weigh(by) { return super.weigh(by) + 1000; } }
class Other { weigh(by) { return -by; } }
const leaves = JSON.parse("[0,0,0]").map(() => new Leaf());
function sum(by) { let all = 0; for (const leaf of leaves) all += leaf.weigh(by); return all; }
console.log("as written", sum(1), sum(2));
Object.setPrototypeOf(Middle[words.proto], Other[words.proto]);
console.log("the link of the class between changed", sum(1), sum(2));
Object.setPrototypeOf(Middle[words.proto], Root[words.proto]);
console.log("and put back", sum(1), sum(2));
const between = Object.create(Root[words.proto]);
Object.setPrototypeOf(Middle[words.proto], between);
console.log("an empty object laid between", sum(1), sum(2));
between[words.weigh] = by => by * 7;
console.log("which gets the name later", sum(1), sum(2));
