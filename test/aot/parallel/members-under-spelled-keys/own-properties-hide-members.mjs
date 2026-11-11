// Objects get own properties under the keys of members of their class, by every road, between warm calls.
const act = Symbol("act"), view = Symbol("view");
class Part {
  n = 1;
  [act]() { return this.n; }
  get [view]() { return this.n + 10; }
}
class Sub extends Part { m = 2; }
function total(parts) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = work;
  for (let i = 0; i < parts.length; i++) sum = (sum + parts[i][act]() + parts[i][view]) | 0;
  return sum;
}
const parts = [];
for (let i = 0; i < 400; i++) parts.push(i & 1 ? new Part() : new Sub());
console.log(total(parts));
parts[0][act] = () => 100;
console.log(total(parts));
Object.defineProperty(parts[1], view, { value: 1000 });
console.log(total(parts));
Object.assign(parts[2], { [act]: () => 10000 });
console.log(total(parts));
Reflect.set(parts[3], act, () => 100000);
console.log(total(parts));
const unseen = x => [x][JSON.parse("0")];
unseen(parts[4])[unseen(act)] = () => 1000000;
console.log(total(parts));
delete parts[0][act];
console.log(total(parts));
Sub.prototype[act] = function () { return this.m; };
console.log(total(parts));
Object.defineProperty(Sub.prototype, view, { get() { return -1; } });
console.log(total(parts));
Object.freeze(Part.prototype);
try { "use strict"; Part.prototype[act] = 1; } catch (e) { console.log(e.name); }
console.log(total(parts), Object.getOwnPropertySymbols(parts[1]).length, act in parts[5], Object.hasOwn(parts[5], act));
