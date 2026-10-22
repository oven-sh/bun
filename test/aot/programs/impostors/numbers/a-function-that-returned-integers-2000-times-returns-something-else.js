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

function pick(list, index) {
  return list[index];
}

function lookup(table, key) {
  if (key in table) return table[key];
}

function countOf(text, letter) {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === letter) count++;
  return count || null;
}

function parse(text) {
  const n = parseInt(text);
  return n;
}

function firstIndex(list, value) {
  let found = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) {
      found = i;
      break;
    }
  }
  return found;
}

function ratio(a, b) {
  let result = 0;
  result = a / b;
  return result;
}

function chosen(flag, other) {
  let n = 0;
  n = flag ? 1 : other;
  return n;
}

function usePick(list, index) {
  const n = pick(list, index);
  return [n + 1, n * 2, n | 0, n < 5];
}

function useLookup(table, key) {
  const n = lookup(table, key);
  return [n + 1, n * 2, n | 0, n < 5];
}

function useCountOf(text, letter) {
  const n = countOf(text, letter);
  return [n + 1, n * 2, n | 0, n < 5];
}

function useParse(text) {
  const n = parse(text);
  return [n + 1, n * 2, n | 0, n < 5, ["a", "b", "c"][n]];
}

function useFirstIndex(list, value) {
  const n = firstIndex(list, value);
  return [n + 1, list[n], n >>> 0, ~n];
}

function useRatio(a, b) {
  const n = ratio(a, b);
  return [n + 1, n | 0, ["a", "b", "c"][n]];
}

function useChosen(flag, other) {
  const n = chosen(flag, other);
  return [n + 1, n | 0, ["a", "b", "c"][n]];
}

for (let i = 0; i < 2000; i++) {
  usePick([1, 2, 3], i % 3);
  useLookup({ a: 1, b: 2 }, i & 1 ? "a" : "b");
  useCountOf("banana", "a");
  useParse("2");
  useFirstIndex([1, 2, 3], 1 + (i % 3));
  useRatio(i * 2, 2);
  useChosen(true, 2);
}

attempt("pick an integer", () => usePick([1, 2, 3], 1));
attempt("pick past the end", () => usePick([1, 2, 3], 3));
attempt("pick a text", () => usePick([1, "2", 3], 1));
attempt("pick a fraction", () => usePick([1, 2.5, 3], 1));
attempt("pick a hole", () => usePick([1, , 3], 1));
attempt("pick a bigint", () => usePick([1, 2n, 3], 1));
attempt("pick from a text", () => usePick("123", 1));
attempt("lookup a known key", () => useLookup({ a: 1 }, "a"));
attempt("lookup an unknown key", () => useLookup({ a: 1 }, "z"));
attempt("lookup an inherited key", () => useLookup({ a: 1 }, "toString"));
attempt("lookup a text", () => useLookup({ a: "1" }, "a"));
attempt("countOf a letter that is there", () => useCountOf("banana", "n"));
attempt("countOf a letter that is not there", () => useCountOf("banana", "z"));
attempt("parse digits", () => useParse("1"));
attempt("parse letters", () => useParse("x"));
attempt("parse a large number", () => useParse("4294967297"));
attempt("parse a negative zero", () => useParse("-0"));
attempt("parse nothing", () => useParse(""));
attempt("firstIndex found", () => useFirstIndex([1, 2, 3], 3));
attempt("firstIndex not found", () => useFirstIndex([1, 2, 3], 9));
attempt("ratio exact", () => useRatio(4, 2));
attempt("ratio with a fraction", () => useRatio(3, 2));
attempt("ratio by zero", () => useRatio(3, 0));
attempt("ratio zero by zero", () => useRatio(0, 0));
attempt("ratio negative zero", () => useRatio(0, -2));
attempt("chosen honest", () => useChosen(false, 2));
attempt("chosen a text", () => useChosen(false, "2"));
attempt("chosen a fraction", () => useChosen(false, 1.5));
attempt("chosen undefined", () => useChosen(false));
attempt("chosen a bigint", () => useChosen(false, 2n));
attempt("chosen 2 ** 31", () => useChosen(false, 2147483648));
attempt("chosen true again", () => useChosen(true, "2"));
