function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function itemAt(list, i) {
  return list[i];
}

function scaled(list, factor) {
  let sum = 0;
  for (let j = 0; j < list.length; j++) sum += list[j] * factor;
  return sum;
}

function repeated(text, count) {
  return text.repeat(count);
}

function padded(text, width) {
  return text.padStart(width, ".");
}

function applied(f, value) {
  return f(value);
}

function stored(object, key, value) {
  object[key] = value;
  return object[key];
}

function shifted(n, by) {
  return n << by;
}

function divided(a, b) {
  return a / b;
}

function honest(round) {
  console.log(round, itemAt([1, 2, 3], 0), itemAt([1, 2, 3], 2), itemAt(["a"], 0), itemAt([], 0), itemAt(new Array(4, 5), 1));
  console.log(round, scaled([1, 2], 2), scaled([], 1), scaled([0.5], 4), scaled(new Array(1, 2, 3), -1));
  console.log(round, repeated("ab", 2), repeated("", 3), repeated("x", 0), padded("a", 3), padded("abc", 2), padded("", 1));
  console.log(round, applied(v => v + 1, 1), applied(v => v * 2, 2), applied(String, 3), stored({}, "a", 1), stored({ a: 0 }, "a", 2), stored([], 0, 3));
  console.log(round, shifted(1, 2), shifted(3, 0), shifted(-1, 31), divided(1, 2), divided(4, 2), divided(1, 0));
}

honest("before");
attempt("itemAt(0, list)", () => itemAt(0, [1, 2, 3]));
attempt("itemAt(1, [1])", () => itemAt(1, [1]));
attempt("itemAt('abc', [1])", () => itemAt("abc", [1]));
attempt("itemAt([1, 2, 3], [1])", () => itemAt([1, 2, 3], [1]));
attempt("itemAt([1, 2, 3], ['length'])", () => itemAt([1, 2, 3], ["length"]));
attempt("itemAt([1, 2, 3], [1, 2])", () => itemAt([1, 2, 3], [1, 2]));
attempt("scaled(2, [1, 2])", () => scaled(2, [1, 2]));
attempt("scaled([1, 2], [2])", () => scaled([1, 2], [2]));
attempt("scaled([1, 2], [2, 3])", () => scaled([1, 2], [2, 3]));
attempt("scaled('12', '2')", () => scaled("12", "2"));
attempt("repeated(2, 'ab')", () => repeated(2, "ab"));
attempt("repeated('ab', '2')", () => repeated("ab", "2"));
attempt("repeated('ab', 'x')", () => repeated("ab", "x"));
attempt("repeated('ab', -1)", () => repeated("ab", -1));
attempt("repeated('ab', 1.9)", () => repeated("ab", 1.9));
attempt("repeated('ab', [2])", () => repeated("ab", [2]));
attempt("padded(3, 'a')", () => padded(3, "a"));
attempt("padded('a', '3')", () => padded("a", "3"));
attempt("padded('a', NaN)", () => padded("a", NaN));
attempt("applied(1, f)", () => applied(1, v => v + 1));
attempt("applied(f, f)", () => typeof applied(v => v, v => v));
attempt("stored('a', {}, 1)", () => stored("a", {}, 1));
attempt("stored({}, {}, 1)", () => stored({}, {}, 1));
attempt("stored([], 'length', 3)", () => stored([], "length", 3));
attempt("stored([], 'length', -1)", () => stored([], "length", -1));
attempt("stored([1, 2], '1', 'x')", () => stored([1, 2], "1", "x"));
attempt("stored([], 1.5, 'x')", () => stored([], 1.5, "x"));
attempt("stored([], -0, 'x')", () => { const list = []; stored(list, -0, "x"); return list; });
attempt("stored(new Uint8Array(1), 0, 300)", () => stored(new Uint8Array(1), 0, 300));
attempt("stored(new Uint8Array(1), 5, 1)", () => stored(new Uint8Array(1), 5, 1));
attempt("stored(Object.freeze({}), 'a', 1)", () => stored(Object.freeze({}), "a", 1));
attempt("stored(5, 'a', 1)", () => stored(5, "a", 1));
attempt("shifted(2, 1) against shifted(1, 2)", () => [shifted(2, 1), shifted(1, 2)]);
attempt("shifted(1, 32)", () => shifted(1, 32));
attempt("shifted(1, -1)", () => shifted(1, -1));
attempt("shifted(1, 1.9)", () => shifted(1, 1.9));
attempt("shifted('1', '2')", () => shifted("1", "2"));
attempt("shifted(1n, 2n)", () => shifted(1n, 2n));
attempt("shifted(1n, 2)", () => shifted(1n, 2));
attempt("divided(0, 1) against divided(1, 0)", () => [divided(0, 1), divided(1, 0), divided(0, -1), divided(-1, 0), divided(0, 0)]);
attempt("divided(1n, 2n)", () => divided(1n, 2n));
attempt("divided(1n, 0n)", () => divided(1n, 0n));
attempt("divided('4', '2')", () => divided("4", "2"));
for (const swap of [false, true, false]) {
  const pair = swap ? [1, [10, 20, 30]] : [[10, 20, 30], 1];
  attempt("one place, swapped " + swap, () => [itemAt(pair[0], pair[1]), scaled(pair[0], pair[1])]);
}
honest("after");
