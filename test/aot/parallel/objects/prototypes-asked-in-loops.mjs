// isPrototypeOf is asked of objects, primitives, proxies and whatever answers under that name.
const base = { a: 1 }, middle = Object.create(base), below = Object.create(middle), other = {}, none = Object.create(null);
class A {}
class B extends A {}
let traps = 0;
const proxy = new Proxy(below, { getPrototypeOf(target) { traps++; if (traps === 7) throw new RangeError("seven"); return Object.getPrototypeOf(target); } });
const values = [middle, below, other, none, new B(), proxy, 1, "text", null, undefined, Symbol.iterator, () => 1, [], base, B];
const holders = [base, middle, Object.prototype, A.prototype, A, Array.prototype, Function.prototype];
function attempt(f) {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
}
function ask(holder, value) { return attempt(() => holder.isPrototypeOf(value)); }
function count(holder, list) {
  let found = 0;
  for (let i = 0; i < list.length * 3; i++) {
    if (attempt(() => holder.isPrototypeOf(list[i % list.length])) === true) found++;
  }
  return found;
}
for (const holder of holders) console.log(values.map(value => String(ask(holder, value))).join(), count(holder, values));
console.log(traps);

function askAll(holders, value) {
  let text = "";
  for (let i = 0; i < holders.length; i++) {
    const holder = holders[i];
    text += attempt(() => holder.isPrototypeOf(value)) + " ";
  }
  return text;
}
console.log(askAll([base, "text", 5, true, { isPrototypeOf(x) { return "own:" + typeof x; } }, { isPrototypeOf: 4 }, none, null, undefined, proxy], below));
const { isPrototypeOf } = Object.prototype;
for (const receiver of [base, undefined, null, 1, "s"]) {
  let text = "";
  for (const value of [below, 1, other]) text += attempt(() => isPrototypeOf.call(receiver, value)) + " ";
  console.log(text, attempt(() => isPrototypeOf.call(receiver)), attempt(() => Reflect.apply(isPrototypeOf, receiver, [below, 2])));
}
function changes() {
  let text = "";
  for (let i = 0; i < 6; i++) {
    if (i === 3) Object.setPrototypeOf(middle, other);
    text += base.isPrototypeOf(below) + "," + other.isPrototypeOf(below) + " ";
  }
  Object.setPrototypeOf(middle, base);
  return text;
}
console.log(changes(), base.isPrototypeOf(), base.isPrototypeOf(below, other), attempt(() => base.isPrototypeOf(...[below])));
base.isPrototypeOf = function (value) { return value === below ? "replaced" : 0; };
console.log(count(base, values), ask(base, below), ask(middle, below), ask(other, below));
