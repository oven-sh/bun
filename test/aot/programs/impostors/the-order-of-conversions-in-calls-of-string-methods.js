function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const log = [];

function noisy(name, result) {
  return {
    [Symbol.toPrimitive](hint) {
      log.push(name + ":" + hint);
      return result;
    },
  };
}

function report(label, run) {
  attempt(label, run);
  console.log("  order:", log.splice(0).join(" "));
}

function slice(text, from, to) {
  return text.slice(from, to);
}

function substring(text, from, to) {
  return text.substring(from, to);
}

function indexOf(text, piece, from) {
  return text.indexOf(piece, from);
}

function padStart(text, length, filler) {
  return text.padStart(length, filler);
}

function replace(text, piece, replacement) {
  return text.replace(piece, replacement);
}

function split(text, separator, limit) {
  return text.split(separator, limit);
}

function startsWith(text, piece, from) {
  return text.startsWith(piece, from);
}

function repeat(text, count) {
  return text.repeat(count);
}

for (let i = 0; i < 2000; i++) {
  slice("hello", 1, 3);
  substring("hello", 1, 3);
  indexOf("hello", "l", 1);
  padStart("x", 3, "ab");
  replace("hello", "l", "L");
  split("a,b", ",", 2);
  startsWith("hello", "e", 1);
  repeat("ab", 2);
}

const generic = name => (receiver, ...rest) => String.prototype[name].call(receiver, ...rest);

report("slice", () => slice("hello", noisy("from", 1), noisy("to", 3)));
report("slice of an empty range still converts both", () => slice("", noisy("from", 1), noisy("to", 3)));
report("slice with a receiver that is converted", () => generic("slice")(noisy("this", "hello"), noisy("from", 1), noisy("to", 3)));
report("substring", () => substring("hello", noisy("from", 3), noisy("to", 1)));
report("indexOf", () => indexOf("hello", noisy("piece", "l"), noisy("from", 3)));
report("indexOf with a receiver that is converted", () => generic("indexOf")(noisy("this", "hello"), noisy("piece", "l"), noisy("from", 3)));
report("padStart", () => padStart("x", noisy("length", 4), noisy("filler", "ab")));
report("padStart that has nothing to add", () => padStart("xxxx", noisy("length", 2), noisy("filler", "ab")));
report("padStart with an empty filler", () => padStart("x", noisy("length", 4), noisy("filler", "")));
report("replace", () => replace("hello", noisy("piece", "l"), noisy("replacement", "L")));
report("replace that finds nothing", () => replace("hello", noisy("piece", "z"), noisy("replacement", "L")));
report("split", () => split("a,b,c", noisy("separator", ","), noisy("limit", 2)));
report("split with limit zero", () => split("a,b,c", noisy("separator", ","), noisy("limit", 0)));
report("startsWith", () => startsWith("hello", noisy("piece", "e"), noisy("from", 1)));
report("repeat", () => repeat("ab", noisy("count", 2)));
report("repeat of the empty text with a huge count", () => repeat("", noisy("count", 2 ** 40)));
report("repeat with a negative count", () => repeat("ab", noisy("count", -1)));
report("repeat with infinity", () => repeat("", noisy("count", Infinity)));
report("the first argument throws", () => slice("hello", { valueOf() { log.push("from throws"); throw new RangeError("no"); } }, noisy("to", 3)));
report("the first argument is a symbol", () => slice("hello", Symbol("s"), noisy("to", 3)));
report("the first argument is a BigInt", () => slice("hello", 1n, noisy("to", 3)));
report("a null receiver is refused before the arguments", () => generic("slice")(null, noisy("from", 1), noisy("to", 3)));
report("an undefined receiver is refused before the arguments", () => generic("indexOf")(undefined, noisy("piece", "l")));
report("a symbol receiver", () => generic("slice")(Symbol("s"), noisy("from", 1)));
report("a regular expression is refused before the position", () => startsWith("hello", /e/, noisy("from", 1)));
report("arguments are evaluated before a missing method is noticed", () => ({}).slice(log.push("argument evaluated")));
report("arguments are not evaluated when the receiver is null", () => null.slice(log.push("argument evaluated")));
report("arguments are not evaluated after ?.", () => null?.slice(log.push("argument evaluated")));
report("the method is read before the arguments are evaluated", () => ({ get slice() { log.push("get slice"); return () => "called"; } }).slice(log.push("argument evaluated")));
