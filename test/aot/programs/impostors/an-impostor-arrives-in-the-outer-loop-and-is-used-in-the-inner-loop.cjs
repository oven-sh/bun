const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

console.log("strict:", (function () { return this === undefined; })());

function pushesInside(lists, inner) {
  const lengths = [];
  for (let i = 0; i < lists.length; i++) {
    const a = lists[i];
    for (let j = 0; j < inner; j++) a.push(j);
    lengths.push(a.length);
  }
  return lengths;
}
function addsInside(numbers, inner) {
  const sums = [];
  for (let i = 0; i < numbers.length; i++) {
    const n = numbers[i];
    let total = 0;
    for (let j = 0; j < inner; j++) total = total + n;
    sums.push(total, total | 0);
  }
  return sums;
}
function readsInside(objects, inner) {
  const sums = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    let total = 0;
    for (let j = 0; j < inner; j++) total += o.x + o.y;
    sums.push(total);
  }
  return sums;
}
function iteratesInside(lists) {
  const seen = [];
  outer: for (let i = 0; i < lists.length; i++) {
    for (const x of lists[i]) {
      if (x === "skip the rest") continue outer;
      if (x === "stop") break outer;
      seen.push(x);
    }
    seen.push("end of " + i);
  }
  return seen;
}
function readsCodesInside(texts) {
  const codes = [];
  for (let i = 0; i < texts.length; i++) {
    const s = texts[i];
    for (let j = 0; j < s.length; j++) codes.push(s.charCodeAt(j));
  }
  return codes;
}
function callsInside(functions, inner) {
  const results = [];
  for (let i = 0; i < functions.length; i++) {
    const f = functions[i];
    for (let j = 0; j < inner; j++) results.push(f(j));
  }
  return results;
}

for (let i = 0; i < 1000; i++) {
  pushesInside([[5], [6]], 2);
  addsInside([1, 2], 2);
  readsInside([{ x: 1, y: 2 }, { x: 3, y: 4 }], 2);
  iteratesInside([[1, 2], [3]]);
  readsCodesInside(["ab", "c"]);
  callsInside([x => x + 1, x => x + 2], 2);
}

for (const inner of [2, 0, 1]) {
  attempt("push, " + inner + " inner turns", () => pushesInside([[5], Odd.of(5), [6], { length: 7, push(value) { log.push("own push " + value); } }, logged([5]), [7]], inner));
  attempt("push onto nothing, " + inner + " inner turns", () => pushesInside([[5], undefined, [6]], inner));
  attempt("push onto a frozen array, " + inner + " inner turns", () => pushesInside([[5], Object.freeze([5]), [6]], inner));
  attempt("sums, " + inner + " inner turns", () => addsInside([1, "2", 3, { valueOf() { log.push("valueOf"); return 4; } }, 2 ** 30, -0, 0.5, undefined, 5], inner));
  attempt("sums with a bigint, " + inner + " inner turns", () => addsInside([1, 10n, 3], inner));
  attempt("members, " + inner + " inner turns", () => readsInside([{ x: 1, y: 2 }, { get x() { log.push("get x"); return 10; }, y: 20 }, { x: 1, y: 2 }, logged({ y: 2, x: 1 }), { y: "2", x: "1" }, { x: 1, y: 2 }], inner));
  attempt("members of nothing, " + inner + " inner turns", () => readsInside([{ x: 1, y: 2 }, null, { x: 1, y: 2 }], inner));
  attempt("calls, " + inner + " inner turns", () => callsInside([x => x + 1, logged(x => x + 2), function (a, b) { return [a, b]; }.bind(null, "bound"), x => x + 3], inner));
  attempt("calls of a class, " + inner + " inner turns", () => callsInside([x => x + 1, class Made {}, x => x + 3], inner));
}
attempt("for-of inside", () => iteratesInside([[1, 2], new Set([3, 4]), "ab", Odd.of(5), [6, "skip the rest", 7], new Map([[8, 9]]), [10], [11, "stop", 12], [13]]));
attempt("for-of over a number inside", () => iteratesInside([[1, 2], 5, [3]]));
attempt("for-of closes the iterator it leaves", () => iteratesInside([[1], { [Symbol.iterator]: () => ({ next: () => ({ done: false, value: "skip the rest" }), return: () => (log.push("return"), {}) }) }, [2]]));
attempt("character codes inside", () => readsCodesInside(["ab", new String("cd"), { length: 2, charCodeAt: j => "own " + j }, "e", ["fg"], "h"]));
attempt("character codes of an array of numbers inside", () => readsCodesInside(["ab", [1, 2], "c"]));
attempt("character codes of a number inside", () => readsCodesInside(["ab", 5, "c"]));
