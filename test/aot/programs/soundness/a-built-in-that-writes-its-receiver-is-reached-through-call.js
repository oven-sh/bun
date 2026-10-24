// f.call(t, a, b): the operands of the built-in do not stand at the positions of the operation that spells the call out.
function one() { return 1; }
function two() { return 2; }

function stored() {
  const map = new Map();
  Map.prototype.set.call(map, one, two);
  return map;
}
console.log(stored().get(one)(), stored().has(two), [...stored().keys()][0](), [...stored().values()][0]());

function pushed() {
  const list = [one];
  Array.prototype.push.call(list, two);
  return list;
}
console.log(pushed().length, pushed()[0](), pushed()[1](), pushed().includes(pushed));

function copies() {
  const first = Array.prototype.slice.call([one]);
  const second = Array.prototype.slice.call([two]);
  first.push(two);
  return [first, second];
}
console.log(copies()[0].length, copies()[1].length, copies()[0][0](), copies()[1][0](), Array.isArray(copies()[0]));

function ofArguments() { return Array.prototype.slice.call(arguments, 1); }
console.log(ofArguments(one, two).length, ofArguments(one, two)[0](), ofArguments().length, Array.isArray(ofArguments(one)));

function ofArrayLike() { return Array.prototype.map.call({ length: 2, 0: one, 1: two }, f => f()); }
console.log(ofArrayLike().join(), Array.isArray(ofArrayLike()));

function withoutReceiver() {
  try {
    return Array.prototype.slice.call();
  } catch (error) {
    return error instanceof TypeError;
  }
}
console.log(withoutReceiver());

function either(which) {
  const method = which ? Array.prototype.slice : Array.prototype.join;
  return method.call([1, 2, 3], which ? 1 : "-");
}
console.log(either(true).length, either(false).length, typeof either(true), typeof either(false));

function defined() {
  const target = {};
  Object.defineProperty.call(null, target, "late", { value: one, enumerable: true });
  return target;
}
console.log(defined().late(), Object.keys(defined()).join());

function twice() { return Function.prototype.call.call(Array.prototype.concat, [one], [two]); }
console.log(twice().length, twice()[1]());

function added() {
  const set = new Set();
  Set.prototype.add.call(set, one);
  return set;
}
console.log(added().size, added().has(one), [...added()][0]());
