const makers = [
  () => [],
  () => [1, 2, 3],
  () => [1.5, 2.5, 3.5],
  () => ["a", {}, 3],
  () => [, 1, , 3],
  () => [1.5, , 3.5],
  () => ["a", , "c"],
  () => new Array(4),
  () => new Array(3).fill(7),
  () => Array.from({ length: 5 }, (_, i) => i * 0.5),
  () => {
    const sparse = [1, 2];
    sparse[100000] = 3;
    return sparse;
  },
  () => Object.freeze([1, 2, 3]),
  () => Object.seal(["a", "b"]),
  () => Object.preventExtensions([1.5, 2.5]),
  () => {
    const named = [1, 2, 3];
    named[-1] = "minus one";
    named[1.5] = "one and a half";
    named[4294967295] = "no index";
    named["NaN"] = "not a number";
    return named;
  },
  () => {
    const fixed = [1, 2, 3];
    Object.defineProperty(fixed, "length", { writable: false });
    return fixed;
  },
  () => {
    const watched = [1, 2, 3];
    Object.defineProperty(watched, 1, { get: () => "from a getter", set() {}, configurable: true });
    return watched;
  },
];

const positions = [0, 1, 2, 3, 4, 5, 7, 8, 9, 100, 100000, -1, -0, 0.5, 1.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, 9007199254740991, 9223372036854775808, -9223372036854775808, 1e300];
const integers = positions.filter(position => Number.isInteger(position) && Math.abs(position) < 2 ** 31).map(position => position | 0);
const values = [0, -1, 7, 2147483648, 0.5, -0, NaN, Infinity, "text", "", null, undefined, true, {}, [], () => 1, Symbol.iterator, 10n];

function show(value) {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol" || typeof value === "bigint") return String(value);
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.length + "]" : "{}";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function showArray(array) {
  const parts = [];
  for (const key of Reflect.ownKeys(array)) {
    if (parts.length > 24) {
      parts.push("..");
      break;
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(array, key);
    parts.push(String(key) + ":" + ("value" in descriptor ? show(descriptor.value) : "accessor"));
  }
  return parts.join(" ");
}

// One access each, so that none stands in a loop of its own function.
function readAt(array, position) {
  return array[position];
}
function readAtInteger(array, position) {
  return array[position | 0];
}
function readBehind(array) {
  return array[array.length];
}
function readLast(array) {
  return array[array.length - 1];
}
function readNumber(array, position) {
  return array[position] + 1;
}
function hasAt(array, position) {
  return position in array;
}
function storeAt(array, position, value) {
  "use strict";
  array[position] = value;
}
function storeAtInteger(array, position, value) {
  "use strict";
  array[position | 0] = value;
}
function storeNumber(array, position, value) {
  "use strict";
  array[position] = value * 0.5;
}
function storeInteger(array, position, value) {
  "use strict";
  array[position] = value | 0;
}
function storeBehind(array, value) {
  "use strict";
  array[array.length] = value;
}
function storeThree(array, value) {
  "use strict";
  let next = array.length;
  array[next++] = value;
  array[next++] = value;
  array[next++] = value;
  return next;
}
const storeSloppy = new Function("array", "position", "value", "array[position] = value;");

function attempt(lines, title, action) {
  try {
    lines.push(title + " = " + show(action()));
  } catch (error) {
    lines.push(title + " throws " + error.constructor.name);
  }
}

export function run() {
  const lines = [];
  makers.forEach((make, number) => {
    const read = make();
    for (const position of positions) {
      attempt(lines, `${number} read ${show(position)}`, () => readAt(read, position));
      attempt(lines, `${number} number ${show(position)}`, () => readNumber(read, position));
      attempt(lines, `${number} has ${show(position)}`, () => hasAt(read, position));
    }
    for (const position of integers) attempt(lines, `${number} read integer ${position}`, () => readAtInteger(read, position));
    attempt(lines, `${number} behind`, () => readBehind(read));
    attempt(lines, `${number} last`, () => readLast(read));

    for (const position of positions) {
      if (position > 200000 && position <= 4294967294) continue;
      for (const value of values) {
        for (const [name, store] of [["store", storeAt], ["sloppy", storeSloppy]]) {
          const array = make();
          attempt(lines, `${number} ${name} ${show(position)} ${show(value)}`, () => store(array, position, value));
          lines.push(showArray(array));
        }
      }
      for (const value of [3, 3.5, NaN]) {
        for (const [name, store] of [["half", storeNumber], ["int", storeInteger]]) {
          const array = make();
          attempt(lines, `${number} ${name} ${show(position)} ${show(value)}`, () => store(array, position, value));
          lines.push(showArray(array));
        }
      }
    }
    for (const position of integers) {
      if (position > 200000) continue;
      const array = make();
      attempt(lines, `${number} store integer ${position}`, () => storeAtInteger(array, position, "x"));
      lines.push(showArray(array));
    }
    for (const value of values) {
      const array = make();
      attempt(lines, `${number} behind ${show(value)}`, () => storeBehind(array, value));
      attempt(lines, `${number} three ${show(value)}`, () => storeThree(array, value));
      lines.push(showArray(array));
    }
  });

  // Vectors are filled until they grow, many times over, with cells that only the array holds while the collector runs.
  for (const make of [i => i, i => i + 0.5, i => ({ i }), i => "s" + i]) {
    const grown = [];
    for (let i = 0; i < 3000; i++) {
      storeBehind(grown, make(i));
      if (i % 1000 === 999) Bun.gc(true);
    }
    let sum = 0;
    for (let i = 0; i < grown.length; i++) {
      const element = readAt(grown, i);
      sum += typeof element === "object" ? element.i : typeof element === "string" ? element.length : element;
    }
    lines.push(`grown ${grown.length} ${sum} ${show(readBehind(grown))}`);
  }

  // An old array takes a young cell behind its last element.
  const old = [{}, {}, {}, {}];
  old.length = 2;
  Bun.gc(true);
  Bun.gc(true);
  storeBehind(old, { young: 1 });
  storeAt(old, 0, { young: 2 });
  Bun.gc(false);
  lines.push(JSON.stringify(old));

  // An array gets a prototype with something under an index: its holes are no longer undefined, and a store may meet a setter.
  const holey = [1, , 3];
  lines.push(show(readAt(holey, 1)), show(readAt(holey, 5)));
  const above = Object.create(Array.prototype, {
    1: { value: "inherited", writable: true, configurable: true },
    5: { value: "inherited behind the end", writable: true, configurable: true },
    3: { set(value) { lines.push("the setter got " + show(value)); }, configurable: true },
    7: { value: "read-only", writable: false },
  });
  Object.setPrototypeOf(holey, above);
  lines.push(show(readAt(holey, 1)), show(readAt(holey, 5)), show(readAtInteger(holey, 1)), show(hasAt(holey, 1)), show(readBehind(holey)), show(readNumber(holey, 1)));
  storeBehind(holey, "for the setter");
  storeAt(holey, 3, "again");
  attempt(lines, "read-only above", () => storeAt(holey, 7, "refused"));
  storeSloppy(holey, 7, "ignored");
  storeAt(holey, 1, "own now");
  lines.push(showArray(holey), show(readAt(holey, 1)));
  return lines;
}
