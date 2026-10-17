// A call with more arguments than fit throws RangeError as soon as the length of the list is known: no element is read.
function count() { return arguments.length; }
function rest(...all) { return all.length; }
function Made() { return { count: arguments.length }; }
let log = [];
function listOf(length) {
  return {
    get length() { log.push("length"); return length; },
    get 0() { log.push("0"); return 1; },
    get 1() { log.push("1"); return 2; },
  };
}
function tell(name, f) {
  log = [];
  let result;
  try {
    result = String(f());
  } catch (e) {
    result = e.name + ": " + e.message;
  }
  console.log(name + ": " + result + " [" + log.join() + "]");
}
for (const length of [0, 2, 0x100001, 2 ** 31, 2 ** 32 + 1, 2 ** 53, Infinity, -1, NaN]) {
  tell("apply " + length, () => count.apply(null, listOf(length)));
  tell("apply to rest parameters " + length, () => rest.apply(null, listOf(length)));
  tell("apply to a built-in " + length, () => Math.max.apply(null, listOf(length)));
  tell("Reflect.apply " + length, () => Reflect.apply(count, null, listOf(length)));
  tell("Reflect.construct " + length, () => Reflect.construct(Made, listOf(length)).count);
}
function argumentsWithLength(length) { arguments.length = length; return arguments; }
tell("an arguments object", () => count.apply(null, argumentsWithLength(2 ** 32 + 1, 2)));
tell("Reflect.apply of an arguments object", () => Reflect.apply(count, null, argumentsWithLength(2 ** 32 + 1, 2)));
const long = [];
long.length = 0x100001;
tell("an array", () => count.apply(null, long));
tell("Reflect.construct of an array", () => Reflect.construct(Made, long).count);
tell("a short array", () => count.apply(null, [1, 2, 3]));
