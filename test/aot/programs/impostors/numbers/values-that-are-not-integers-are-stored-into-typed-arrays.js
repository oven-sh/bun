function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
const log = [];
const values = [1, -1, 0.5, 1.5, 2.5, -0.5, -1.5, 127.5, 128, 255, 255.5, 256, 257, -129, 32768, 65536, 2147483647, 2147483648, 4294967295, 4294967296, 4294967297, -2147483649, 1e21, -0, NaN, Infinity, -Infinity, "3", "", "abc", " 12 ", "0x10", null, undefined, true, false, [], [5], [1, 2], {}, new Date(7)];

function store(array, value) {
  array[0] = value;
  return array[0];
}

function storeAndAdd(array, value) {
  array[0] = 1;
  array[0] += value;
  return array[0];
}

function resultOfTheStore(array, value) {
  return (array[0] = value);
}

for (const kind of kinds) {
  const array = new kind(2);
  for (let i = 0; i < 1000; i++) {
    store(array, i & 63);
    storeAndAdd(array, i & 63);
  }
}

for (const kind of kinds) {
  const array = new kind(2);
  attempt(kind.name + " store", () => values.map(value => store(array, value)));
  attempt(kind.name + " storeAndAdd", () => values.map(value => storeAndAdd(array, value)));
  attempt(kind.name + " from", () => Array.from(kind.from(values)));
  attempt(kind.name + " fill", () => values.slice(0, 12).map(value => array.fill(value)[1]));
  attempt(kind.name + " set", () => {
    array.set(["7", 2.5]);
    return Array.from(array);
  });
  attempt(kind.name + " a bigint", () => store(array, 1n));
  attempt(kind.name + " a symbol", () => store(array, Symbol("s")));
  attempt(kind.name + " an object", () => {
    log.length = 0;
    const stored = store(array, {
      valueOf() {
        log.push("valueOf");
        return 3.7;
      },
    });
    return [stored, log.length];
  });
  attempt(kind.name + " an object out of range is still converted", () => {
    log.length = 0;
    array[5] = {
      valueOf() {
        log.push("valueOf");
        return 1;
      },
    };
    return [array[5], log.length];
  });
  attempt(kind.name + " the store expression keeps its value", () => [resultOfTheStore(array, 300.5), resultOfTheStore(array, "9"), resultOfTheStore(array, -0)]);
}

attempt("BigInt64Array takes no number", () => store(new BigInt64Array(1), 1));
attempt("BigInt64Array wraps", () => [store(new BigInt64Array(1), 2n ** 63n), store(new BigUint64Array(1), -1n)]);
attempt("BigInt64Array takes a text", () => store(new BigInt64Array(1), "12"));
attempt("BigInt64Array takes true", () => store(new BigInt64Array(1), true));
