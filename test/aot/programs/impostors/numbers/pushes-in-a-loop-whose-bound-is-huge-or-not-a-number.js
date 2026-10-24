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

function firstFive(bound) {
  const list = [];
  for (let i = 0; i < bound; i++) {
    list.push(i);
    if (list.length === 5) break;
  }
  return list;
}

function firstFiveInclusive(bound) {
  const list = [];
  for (let i = 0; i <= bound; i++) {
    list.push(i * 2);
    if (list.length === 5) break;
  }
  return list;
}

function firstFiveByIndex(bound) {
  const list = [];
  for (let i = 0; i < bound; i++) {
    list[i] = i;
    if (i === 4) break;
  }
  return list;
}

function lastFive(bound) {
  const list = [];
  for (let i = bound; i > 0; i--) {
    list.push(i);
    if (list.length === 5) break;
  }
  return list;
}

function returnsEarly(bound) {
  const list = [];
  for (let i = 0; i < bound; i++) {
    if (i === 3) return list;
    list.push(i);
  }
  return list;
}

function throwsEarly(bound) {
  const list = [];
  try {
    for (let i = 0; i < bound; i++) {
      if (i === 3) throw new RangeError("enough");
      list.push(i);
    }
  } catch {
    list.push("caught");
  }
  return list;
}

function whole(bound) {
  const list = [];
  for (let i = 0; i < bound; i++) list.push(i);
  return list;
}

function mapped(bound) {
  return Array.from({ length: Math.min(bound, 5) }, (_, i) => i);
}

const early = [firstFive, firstFiveInclusive, firstFiveByIndex, lastFive, returnsEarly, throwsEarly];
for (let i = 0; i < 1000; i++) {
  for (const use of early) use(i % 8);
  whole(i % 8);
  mapped(i % 8);
}

for (const bound of [3, 7, Infinity, 1e18, 2147483647, 2147483648, 4294967295, 4294967296, 9007199254740992, 1e308, "7", "3", "abc", "", 2.5, 0.5, NaN, -1, -0, -Infinity, null, undefined, true, 7n, 10n ** 30n, [7], { valueOf: () => 7 }, Symbol("s")]) {
  for (const use of early) attempt(use.name + "(" + show(bound) + ")", () => use(bound));
}
for (const bound of [3, "3", 2.5, 0.5, NaN, -1, -0, null, undefined, true, 3n, [3], { valueOf: () => 3 }]) {
  attempt("whole(" + show(bound) + ")", () => whole(bound));
  attempt("mapped(" + show(bound) + ")", () => mapped(bound));
}
