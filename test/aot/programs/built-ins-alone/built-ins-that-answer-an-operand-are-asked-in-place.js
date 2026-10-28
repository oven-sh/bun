// Built-ins that answer an operand, asked in place whether they do, and built-ins that make something new unless a condition holds: Promise.resolve, RegExp(pattern), Iterator.from, the legacy call of two Intl constructors, species.
function show(label, ...values) { console.log(label, ...values); }
// Promise.resolve answers its operand only where operand.constructor is the receiver.
class Mine extends Promise {}
class Mine2 extends Promise {}
{
  const mine = new Mine(resolve => resolve(1));
  const got = Promise.resolve(mine);
  got.extra = 1;
  show("Promise.resolve(subclass)", got === mine, got instanceof Mine, mine.extra, Object.getPrototypeOf(got) === Promise.prototype);
  const back = Mine.resolve(mine);
  show("Mine.resolve(subclass)", back === mine);
  const plain = Promise.resolve(2);
  const same = Promise.resolve(plain);
  show("Promise.resolve(plain)", same === plain);
  const lifted = Mine.resolve(plain);
  lifted.extra = 2;
  show("Mine.resolve(plain)", lifted === plain, lifted instanceof Mine, plain.extra);
  const changed = Promise.resolve(3);
  changed.constructor = Mine;
  const other = Promise.resolve(changed);
  other.extra = 3;
  show("Promise.resolve(own constructor)", other === changed, changed.extra);
  const relinked = Promise.resolve(4);
  Object.setPrototypeOf(relinked, Mine.prototype);
  const another = Promise.resolve(relinked);
  another.extra = 4;
  show("Promise.resolve(relinked)", another === relinked, relinked.extra);
}
// RegExp(pattern) answers the pattern only where pattern.constructor is RegExp and no flags are passed.
{
  const pattern = /a/g;
  show("RegExp(pattern)", RegExp(pattern) === pattern, RegExp(pattern, "i") === pattern, new RegExp(pattern) === pattern);
  class MyRegExp extends RegExp {}
  const mine = new MyRegExp("a");
  const got = RegExp(mine);
  got.extra = 1;
  show("RegExp(subclass)", got === mine, mine.extra, got instanceof MyRegExp);
  const changed = /b/;
  changed.constructor = MyRegExp;
  const other = RegExp(changed);
  other.extra = 2;
  show("RegExp(own constructor)", other === changed, changed.extra);
}
// Iterator.from answers an iterator that is below Iterator.prototype, and wraps any other.
{
  const list = [1, 2].values();
  const got = Iterator.from(list);
  got.extra = 1;
  show("Iterator.from(iterator)", got === list, list.extra);
  const bare = { next() { return { done: true, value: undefined }; } };
  const wrapped = Iterator.from(bare);
  wrapped.extra = 2;
  show("Iterator.from(bare)", wrapped === bare, bare.extra, wrapped instanceof Iterator);
  class Own extends Iterator { next() { return { done: true, value: undefined }; } }
  const own = new Own();
  const back = Iterator.from(own);
  back.extra = 3;
  show("Iterator.from(subclass)", back === own, own.extra);
}
// The legacy call of two Intl constructors on an instance answers that instance.
{
  const format = new Intl.NumberFormat("en");
  const got = Intl.NumberFormat.call(format, "de");
  got.extra = 1;
  show("Intl.NumberFormat.call(instance)", got === format, format.extra);
  const dates = new Intl.DateTimeFormat("en");
  const other = Intl.DateTimeFormat.call(dates, "de");
  other.extra = 2;
  show("Intl.DateTimeFormat.call(instance)", other === dates, dates.extra);
  const below = Object.create(Intl.NumberFormat.prototype);
  const third = Intl.NumberFormat.call(below, "de");
  third.extra = 3;
  show("Intl.NumberFormat.call(below the prototype)", third === below, below.extra);
}
// Rows that answer an operand.
{
  const target = { a: 1 };
  show("Object.assign", Object.assign(target, { b: 2 }) === target, typeof Object.assign(5, { b: 2 }), Object.assign("t", {}) instanceof String);
  show("Object.freeze", Object.freeze(target) === target, Object.freeze(5), Object.seal("t"), Object.preventExtensions(null));
  const open = {};
  show("Object.defineProperty", Object.defineProperty(open, "x", { value: 1 }) === open, Object.defineProperties(open, {}) === open, Object.setPrototypeOf(open, null) === open, Object.setPrototypeOf(5, null));
  show("Object", Object(target) === target, typeof Object(5), typeof Object(null), Object(undefined) === undefined);
  const list = [3, 1, 2];
  show("Array", list.sort() === list, list.reverse() === list, list.fill(0) === list, list.copyWithin(0, 1) === list);
  const like = { length: 2, 0: "b", 1: "a" };
  show("Array on an object", Array.prototype.sort.call(like) === like, Array.prototype.reverse.call(like) === like, Array.prototype.fill.call(like, 0) === like, Array.prototype.copyWithin.call(like, 0, 1) === like);
  show("Array on a text", typeof Array.prototype.sort.call(""), Array.prototype.reverse.call("") instanceof String, typeof Array.prototype.fill.call(5, 0));
  const bytes = new Uint8Array([3, 1, 2]);
  show("TypedArray", bytes.sort() === bytes, bytes.reverse() === bytes, bytes.fill(0) === bytes, bytes.copyWithin(0, 1) === bytes);
  const map = new Map(), set = new Set(), weakMap = new WeakMap(), weakSet = new WeakSet();
  show("collections", map.set(1, 2) === map, set.add(1) === set, weakMap.set(target, 1) === weakMap, weakSet.add(target) === weakSet);
  show("valueOf", target.valueOf() === target, typeof Object.prototype.valueOf.call(5), Object.prototype.valueOf.call("t") instanceof String);
  const symbol = Symbol("s");
  show("Symbol", symbol.valueOf() === symbol, Object(symbol).valueOf() === symbol, Object(symbol)[Symbol.toPrimitive]("default") === symbol);
  show("species", Array[Symbol.species] === Array, Map[Symbol.species] === Map, Reflect.get(Promise, Symbol.species, target) === target);
  const steps = [1].values();
  show("iterators", steps[Symbol.iterator]() === steps, Iterator.prototype[Symbol.iterator].call(5), Iterator.prototype[Symbol.iterator].call(target) === target);
  const pattern = /a/;
  show("compile", pattern.compile("b") === pattern);
  show("reduce", [].reduce(() => 1, target) === target, [1].reduce(() => list, target) === list, [].reduceRight(() => 1, target) === target);
  show("eval", eval(target) === target, eval(5), eval("1 + 1"), eval());
  const stack = new DisposableStack();
  const held = { [Symbol.dispose]() {} };
  show("DisposableStack", stack.use(held) === held, stack.use(null), stack.adopt(target, () => {}) === target);
  show("getOrInsert", typeof map.getOrInsert === "function" ? map.getOrInsert(1, target) === 2 && map.getOrInsert(9, target) === target : "none");
}
// Species: what a method makes is what the constructor of the receiver makes.
{
  class Mine extends Array {}
  const mine = Mine.from([1, 2, 3]);
  show("species of Array", mine.map(x => x) instanceof Mine, mine.filter(() => true) instanceof Mine, mine.slice() instanceof Mine, mine.concat([1]) instanceof Mine, mine.splice(0, 1) instanceof Mine, mine.flat() instanceof Mine, mine.flatMap(x => [x]) instanceof Mine);
  const kept = [];
  class Handed extends Array { static get [Symbol.species]() { return function () { return kept; }; } }
  const handed = new Handed(1, 2, 3);
  const mapped = handed.map(x => x * 2);
  show("species that hands out one list", mapped === kept, kept.join());
  class MyBytes extends Uint8Array {}
  const bytes = new MyBytes(4);
  show("species of TypedArray", bytes.slice() instanceof MyBytes, bytes.subarray(1) instanceof MyBytes, bytes.map(x => x) instanceof MyBytes, bytes.filter(() => true) instanceof MyBytes);
  class MyBuffer extends ArrayBuffer {}
  show("species of ArrayBuffer", new MyBuffer(8).slice(0) instanceof MyBuffer);
  const chained = new Mine2(resolve => resolve(1)).then(x => x);
  show("species of Promise", chained instanceof Mine2, new Mine2(r => r(1)).catch(() => {}) instanceof Mine2, new Mine2(r => r(1)).finally(() => {}) instanceof Mine2);
}
