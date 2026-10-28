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

const names = ["zero", "one", "two", "three", "four", "five", "six", "seven"];

function use(n) {
  return [n, n + 1, n | 0, names[n], n < 3, n === n];
}

const sources = {
  "charCodeAt in range": () => "\u0003".charCodeAt(0),
  "charCodeAt past the end": () => "a".charCodeAt(1),
  "charCodeAt of an empty text": () => "".charCodeAt(0),
  "charCodeAt at -1": () => "a".charCodeAt(-1),
  "codePointAt in range": () => "\u0003".codePointAt(0),
  "codePointAt past the end": () => "a".codePointAt(1),
  "codePointAt of a pair": () => "\u{1F600}".codePointAt(0),
  "indexOf found": () => "abc".indexOf("c"),
  "indexOf not found": () => "abc".indexOf("z"),
  "lastIndexOf not found": () => [1, 2].lastIndexOf(9),
  "findIndex not found": () => [1, 2].findIndex(x => x > 5),
  "findLastIndex not found": () => [1, 2].findLastIndex(x => x > 5),
  "search not found": () => "abc".search(/z/),
  "find not found": () => [1, 2].find(x => x > 5),
  "at past the end": () => [1, 2].at(5),
  "pop of an empty array": () => [].pop(),
  "shift of an empty array": () => [].shift(),
  "getDay": () => new Date(86400000 * 4).getUTCDay(),
  "getDay of an invalid date": () => new Date(NaN).getDay(),
  "getUTCDay of an invalid date": () => new Date(NaN).getUTCDay(),
  "getMonth of an invalid date": () => new Date("nonsense").getMonth(),
  "getDate of an invalid date": () => new Date(NaN).getDate(),
  "getHours of an invalid date": () => new Date(NaN).getHours(),
  "getMinutes of an invalid date": () => new Date(NaN).getMinutes(),
  "getSeconds of an invalid date": () => new Date(NaN).getSeconds(),
  "getMilliseconds of an invalid date": () => new Date(NaN).getMilliseconds(),
  "getFullYear of an invalid date": () => new Date(NaN).getFullYear(),
  "getTimezoneOffset of an invalid date": () => new Date(NaN).getTimezoneOffset(),
  "getTime of an invalid date": () => new Date(8.64e15 + 1).getTime(),
  "Date.UTC of nothing": () => Date.UTC(),
  "Date.parse of nonsense": () => Date.parse("nonsense"),
  "setDate of an invalid date": () => new Date(NaN).setDate(1),
  "Math.max of nothing": () => Math.max(),
  "Math.min of nothing": () => Math.min(),
  "Math.max of an empty spread": () => Math.max(...[]),
  "Math.sign of NaN": () => Math.sign(NaN),
  "Math.sign of -0": () => Math.sign(-0),
  "Math.round of -0.2": () => Math.round(-0.2),
  "Math.clz32 of 0": () => Math.clz32(0),
  "Math.floor of Infinity": () => Math.floor(Infinity),
  "parseInt of nothing": () => parseInt(""),
  "parseInt of -0": () => parseInt("-0"),
  "parseInt of a large number": () => parseInt("99999999999"),
  "Number of a blank": () => Number(" "),
  "Number of letters": () => Number("x"),
  "localeCompare": () => "a".localeCompare("b"),
  "push": () => [1, 2].push(3),
  "unshift": () => [1, 2].unshift(3),
  "push on an array-like with a large length": () => Array.prototype.push.call({ length: 4294967295 }, 1),
  "the length of a sparse array": () => Object.assign([], { 4294967294: 1 }).length,
  "the size of a set": () => new Set([1, 1, 2]).size,
  "the length of a function": () => ((a, b, c) => 0).length,
  "a length that was redefined": () => Object.defineProperty(() => 0, "length", { value: 2.5 }).length,
  "the index of a match": () => /c/.exec("abc").index,
  "lastIndex set to a text": () => Object.assign(/c/g, { lastIndex: "1" }).lastIndex,
  "byteLength": () => new ArrayBuffer(3).byteLength,
  "byteLength after a transfer": () => {
    const buffer = new ArrayBuffer(3);
    buffer.transfer();
    return buffer.byteLength;
  },
  "the length of a typed array after a transfer": () => {
    const bytes = new Uint8Array(3);
    bytes.buffer.transfer();
    return bytes.length;
  },
  "an element of a typed array after a transfer": () => {
    const bytes = new Uint8Array([1, 2, 3]);
    bytes.buffer.transfer();
    return bytes[1];
  },
  "an element of a Uint32Array": () => new Uint32Array([4294967295])[0],
  "an element of a Float32Array": () => new Float32Array([1.5])[0],
  "an element past the end of an Int32Array": () => new Int32Array(1)[1],
  "getInt32": () => new DataView(new ArrayBuffer(4)).getInt32(0),
  "getUint32": () => {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, -1);
    return view.getUint32(0);
  },
  "Atomics.add": () => Atomics.add(new Int32Array(new SharedArrayBuffer(4)), 0, 5),
  "Number.MAX_SAFE_INTEGER": () => Number.MAX_SAFE_INTEGER,
  "Number.MIN_VALUE": () => Number.MIN_VALUE,
  "Number.EPSILON": () => Number.EPSILON,
};

for (let i = 0; i < 2000; i++) use(i & 7);
for (const name of Object.keys(sources)) attempt(name, () => use(sources[name]()));
