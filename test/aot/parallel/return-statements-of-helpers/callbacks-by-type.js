// lodash's baseIteratee: the caller's own function comes back, so the loop below calls one known function.
// STATISTIC: CallsWithSeparateReturns >= 6
function identity(value) {
  return value;
}
function matches(source) {
  return function (object) {
    return object.kind === source.kind;
  };
}
function matchesProperty(path, value) {
  return function (object) {
    return object[path] === value;
  };
}
function property(key) {
  return function (object) {
    return object == null ? undefined : object[key];
  };
}
function propertyDeep(path) {
  return function (object) {
    return path.reduce((held, key) => held[key], object);
  };
}
function iteratee(value) {
  if (typeof value == "function") return value;
  if (value == null) return identity;
  if (typeof value == "object") return Array.isArray(value) ? (value.length > 1 ? matchesProperty(value[0], value[1]) : propertyDeep(value)) : matches(value);
  return property(value);
}

function sum(array, callback) {
  let result;
  for (let i = 0; i < array.length; i++) {
    const current = callback(array[i]);
    if (current !== undefined) result = result === undefined ? current : result + current;
  }
  return result;
}
function sumBy(array, callback) {
  return array && array.length ? sum(array, iteratee(callback)) : 0;
}

function pick(array, callback) {
  const out = [];
  for (const item of array) if (callback(item)) out.push(item.name);
  return out.join();
}
function pickBy(array, callback) {
  return pick(array, iteratee(callback));
}
function keys(array, callback) {
  return array.map(iteratee(callback)).join();
}

const items = Array.from({ length: 60 }, (_, k) => ({ name: "n" + (k % 7), price: ((k * 37) % 91) + 0.5, count: k % 6, kind: "abc"[k % 3] }));
let total = 0;
for (let k = 0; k < 200; k++) total += sumBy(items, item => item.price * item.count);
console.log(total, sumBy([], null));
console.log(pickBy(items.slice(0, 9), { kind: "b" }), pickBy(items.slice(0, 9), ["name", "n3"]), pickBy(items.slice(0, 5), null));
console.log(keys(items.slice(0, 4), "name"), keys([{ name: { length: 2 } }], ["name"]), keys(["x"]));

// A parameter that a callee passes back is the caller's own operand.
function orElse(value, other) {
  return value === undefined ? other : value;
}
console.log(orElse(undefined, 1) + 1, orElse("a", 1) + 1, orElse(null, x => x), orElse(undefined, x => x * 2)(4), orElse([3])[0]);

// What is assigned to the parameter comes back.
function assigned(value) {
  if (!value) value = "assigned";
  return value;
}
console.log(assigned(0), assigned("given"), assigned(() => 1)());

// The arguments object and a later assignment reach the parameter too.
function throughArguments(value) {
  arguments[0] = typeof value;
  return value;
}
function throughClosure(value) {
  const set = () => (value = "set");
  if (value === 2) set();
  return value;
}
console.log(throughArguments(() => 1), throughClosure(2), throughClosure(x => x + 1)(2));

// Each way out of a try decides.
function finallyDecides(value) {
  try {
    if (typeof value === "function") return value;
    throw value;
  } catch (error) {
    return error;
  } finally {
    if (value === 3) return identity;
  }
}
console.log(finallyDecides(3)(9), finallyDecides(x => -x)(9), finallyDecides("thrown"));

// Called by unseen code as well.
const held = [1, "a", null, () => "called"].map(value => iteratee(value));
console.log(held.map(callback => typeof callback).join(), held[1]({ a: 5 }), held[3]());
console.log(Reflect.apply(iteratee, null, ["price"])(items[0]), iteratee.call(null, x => x.count)(items[5]), iteratee(...["name"])(items[6]), new Function("f", "return f('kind')")(iteratee)(items[2]));
