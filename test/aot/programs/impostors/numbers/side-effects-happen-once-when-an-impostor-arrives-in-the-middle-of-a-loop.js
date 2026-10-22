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

const log = [];
const tally = { before: 0, after: 0 };

function doubledSum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    tally.before++;
    log.push("b" + i);
    total += list[i] * 2;
    log.push("a" + i);
    tally.after++;
  }
  return total;
}

function maskedSum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    tally.before++;
    log.push("b" + i);
    total = (total + (list[i] & 255)) | 0;
    log.push("a" + i);
    tally.after++;
  }
  return total;
}

function plainSum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    tally.before++;
    log.push("b" + i);
    total += list[i];
    log.push("a" + i);
    tally.after++;
  }
  return total;
}

function note(value) {
  log.push("note");
  return value;
}

function sumWithCallsAround(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += note(1) * list[i] * note(2);
  return total;
}

function incrementAll(list) {
  for (let i = 0; i < list.length; i++) {
    log.push("b" + i);
    list[i]++;
  }
  return list;
}

function countersInOneExpression(list) {
  let i = 0;
  let total = 0;
  while (i < list.length) total += list[i++] - list[i++ % list.length] + i;
  return [total, i];
}

const uses = [doubledSum, maskedSum, plainSum, sumWithCallsAround, incrementAll, countersInOneExpression];
for (let round = 0; round < 1000; round++) for (const use of uses) use([1, 2, 3, 4]);

const impostors = {
  "a text": () => "5",
  "a fraction": () => 0.5,
  "undefined": () => undefined,
  "a bigint": () => 5n,
  "a symbol": () => Symbol("s"),
  "the largest int32": () => 2147483647,
  "negative zero": () => -0,
  "an object that logs": () => ({
    valueOf() {
      log.push("valueOf");
      return 5;
    },
  }),
  "an object that throws": () => ({
    valueOf() {
      log.push("valueOf");
      throw new RangeError("no");
    },
  }),
};

for (const use of uses) {
  for (const name of Object.keys(impostors)) {
    for (const position of [0, 2, 3]) {
      const list = [1, 2, 3, 4];
      list[position] = impostors[name]();
      log.length = 0;
      tally.before = 0;
      tally.after = 0;
      const result = outcome(() => use(list));
      console.log(use.name, "with", name, "at", position, "->", result, "|", log.join(" "), "|", tally.before, tally.after);
    }
  }
}
