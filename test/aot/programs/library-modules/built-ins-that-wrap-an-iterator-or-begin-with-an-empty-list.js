// The engine's own JavaScript for Array.from, Object.groupBy, Map.groupBy, TypedArray.from, Iterator.concat, the iterator helpers and Reflect.apply:
// each walks a wrapper object whose Symbol.iterator method hands back an iterator that was taken before, or collects into a list that begins empty.
const log = [];
function show(title, make) {
  try {
    const made = make();
    log.push(title + ": " + JSON.stringify(made, (key, value) => (value instanceof Map ? [...value] : ArrayBuffer.isView(value) ? [...value] : value)));
  } catch (error) {
    log.push(title + ": " + error.constructor.name + " " + error.message);
  }
}
function counted(values) {
  let asked = 0;
  return {
    get [Symbol.iterator]() {
      asked++;
      log.push("Symbol.iterator was read " + asked + " times");
      return function () {
        return values[Symbol.iterator]();
      };
    },
  };
}
show("Array.from of an iterable", () => Array.from(counted([1, 2, 3])));
show("Array.from with a function", () => Array.from(counted([1, 2, 3]), (value, index) => value * 10 + index));
show("Array.from of an array-like", () => Array.from({ length: 3, 0: "a", 2: "c" }));
show("Array.from of a length", () => Array.from({ length: 3 }));
show("Array.from of a length with a function", () => Array.from({ length: 3 }, (value, index) => index * 2));
show("Array.from of a length that is no number", () => Array.from({ length: "2" }, (value, index) => index));
show("Array.from of a string", () => Array.from("a\u{1F600}b"));
show("Array.from of what is not iterable", () => Array.from({ [Symbol.iterator]: 1 }));
show("Array.from below another constructor", () => {
  class List extends Array {}
  const made = Array.from.call(List, counted([4, 5]));
  return [made instanceof List, made.length, ...made];
});
show("Object.groupBy", () => Object.groupBy(counted([1, 2, 3, 4, 5]), value => (value & 1 ? "odd" : "even")));
show("Map.groupBy", () => Map.groupBy(counted([1, 2, 3, 4, 5]), value => value % 3));
show("Object.fromEntries", () => Object.fromEntries(counted([["a", 1], ["b", 2]])));
show("Int16Array.from of an iterable", () => Int16Array.from(counted([1, 2, 70000])));
show("Float64Array.from with a function", () => Float64Array.from(counted([1, 2]), value => value / 4));
show("Uint8Array.from of an array-like", () => Uint8Array.from({ length: 2, 0: 7, 1: 300 }));
show("Iterator.from", () => [...Iterator.from(counted([1, 2]))]);
show("Iterator.from of a string", () => [...Iterator.from("ab")]);
show("flatMap", () => [...[1, 2].values().flatMap(value => counted([value, value * 2]))]);
show("flatMap over a string", () => [...[1].values().flatMap(() => "ab")]);
show("map, filter, take, drop", () => [
  ...[1, 2, 3, 4, 5, 6]
    .values()
    .map(value => value * 2)
    .filter(value => value % 3)
    .drop(1)
    .take(2),
]);
show("reduce, some, every, find, toArray", () => {
  const values = () => [1, 2, 3].values();
  return [values().reduce((sum, value) => sum + value), values().some(value => value > 2), values().every(value => value > 2), values().find(value => value > 1), values().toArray()];
});
if (typeof Iterator.concat === "function") show("Iterator.concat", () => [...Iterator.concat(counted([1]), [2, 3], counted([4]))]);
show("Reflect.apply with an array", () => Reflect.apply(Math.max, undefined, [1, 5, 3]));
show("Reflect.apply with an array-like", () => Reflect.apply(Math.max, undefined, { length: 2, 0: 9, 1: 4 }));
show("Reflect.apply with arguments", () => (function () { return Reflect.apply(Math.min, undefined, arguments); })(3, 2, 8));
show("Reflect.apply with no list", () => Reflect.apply(Math.max, undefined, 1));
show("an iterator that is closed early", () => {
  const closed = [];
  const source = {
    [Symbol.iterator]() {
      return { next: () => ({ done: false, value: 1 }), return() { closed.push("closed"); return {}; } };
    },
  };
  try {
    Object.groupBy(source, () => { throw new RangeError("stop"); });
  } catch (error) {
    closed.push(error.message);
  }
  return closed;
});
(async () => {
  if (typeof Array.fromAsync === "function") {
    const made = await Array.fromAsync((async function* () { yield 1; yield 2; })(), value => value + 1);
    log.push("Array.fromAsync: " + JSON.stringify(made));
    log.push("Array.fromAsync of an iterable: " + JSON.stringify(await Array.fromAsync(counted([Promise.resolve(3), 4]))));
  }
  console.log(log.join("\n"));
})();
