// The accessors that the minified export helper of a split bundle lays are those that plain Bun lays.
// STATISTIC: KnownHelperCalls >= 2
import { lay, m } from "./helpers.mjs";
var first = {};
lay(first, { add: () => add, count: () => count, default: () => first });
var second = { own: 1 };
lay(second, { late: () => late, own: () => "getter" });
var third = {};
lay(third, { count: () => count, late: () => late });
let count = 1;
function add(a, b) {
  return a + b;
}
const out = [];
try {
  second.late;
} catch (error) {
  out.push(error.name);
}
const late = "late";
for (let i = 0; i < 40; i++) {
  if (i === 10) count++;
  if (i === 20) first.count = "stored";
  if (i === 30) Object.defineProperty(first, "add", { value: (a, b) => a * b });
  if (i % 10 === 5) out.push(first.add(i, 2), first.count);
}
const described = Object.getOwnPropertyDescriptors(first);
const { get, set, ...flags } = described.count;
out.push(JSON.stringify(flags), Object.keys(described.count).join(), get.name, get.length, set.name, set.length);
out.push(set === described.default.set, Reflect.ownKeys(set).join(), set.call(null, 1), first.count);
out.push(first.default === first, m(first) === Object.prototype, JSON.stringify({ ...second }));
[first].forEach(object => {
  delete object.count;
});
out.push(String(first.count), Object.keys(first).join());
out.push(JSON.stringify({ ...third, ...second }), Object.keys(third).join());
export { third as default };
console.log(out.join(" "), first, second);
