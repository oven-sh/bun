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
globalThis.log = log;

function countUp(value) {
  let rounds = 0;
  for (let i = 0; i < value.length; i++) {
    rounds++;
    if (rounds >= 6) break;
  }
  return rounds;
}

function countDown(value) {
  let rounds = 0;
  for (let i = value.length - 1; i >= 0; i--) {
    rounds++;
    if (rounds >= 6) break;
  }
  return rounds;
}

function countWithSavedLength(value) {
  let rounds = 0;
  for (let i = 0, length = value.length; i < length; i++) {
    rounds++;
    if (rounds >= 6) break;
  }
  return rounds;
}

function countUntilEqual(value) {
  let rounds = 0;
  for (let i = 0; i !== value.length; i++) {
    rounds++;
    if (rounds >= 6) break;
  }
  return rounds;
}

function lastIndex(value) {
  return value.length - 1;
}

function half(value) {
  return [value.length / 2, value.length >> 1, (value.length / 2) | 0, Math.floor(value.length / 2)];
}

function lengthPlusOne(value) {
  return value.length + 1;
}

function isLongest(value) {
  return [value.length > 2, value.length >= 3, value.length === 3, value.length == 3, value.length !== 0, !value.length];
}

function padding(value) {
  return " ".repeat(Math.max(0, 5 - value.length)) + "|";
}

function newListOfThatLength(value) {
  return new Array(value.length).length;
}

const uses = [
  ["up", countUp],
  ["down", countDown],
  ["saved", countWithSavedLength],
  ["until equal", countUntilEqual],
  ["last index", lastIndex],
  ["half", half],
  ["plus one", lengthPlusOne],
  ["comparisons", isLongest],
  ["padding", padding],
  ["new list", newListOfThatLength],
];

const lengths = ["3", "'3'", "'03'", "' 3 '", "'three'", "''", "2.5", "-1", "-0", "0", "NaN", "Infinity", "-Infinity", "2147483648", "4294967296", "1e21", "null", "undefined", "true", "false", "3n", "[3]", "[]", "{}", "new Number(3)", "new String('3')", "{ valueOf() { log.push('valueOf'); return 3; } }", "{ toString() { log.push('toString'); return '3'; } }", "Symbol('3')"];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(i % 2 ? "abc" : ["a", "b", "c"])).length;
}
console.log("2000 honest rounds", total);

for (const text of lengths) {
  for (let from = 0; from < uses.length; from += 5) {
    console.log("length " + text + " -> " + uses.slice(from, from + 5).map(([name, use]) => {
      try {
        return name + " " + show(use({ length: make(text) }));
      } catch (error) {
        return name + " threw " + error.constructor.name;
      }
    }).join("; "));
  }
  if (log.length) console.log("  conversions:", log.splice(0).length);
}

attempt("a length that is read again in every round", () => {
  let reads = 0;
  const rounds = countUp({ get length() { reads++; return 3; } });
  return [rounds, reads];
});
attempt("a saved length is read once", () => {
  let reads = 0;
  const rounds = countWithSavedLength({ get length() { reads++; return 3; } });
  return [rounds, reads];
});
attempt("a length that grows", () => {
  let length = 1;
  return countUp({ get length() { return length++; } });
});
attempt("a length that shrinks", () => {
  let length = 5;
  return countUp({ get length() { return length--; } });
});
attempt("a length that turns into a text", () => {
  let reads = 0;
  return countUp({ get length() { return reads++ < 2 ? 4 : "3"; } });
});
attempt("honest again", () => uses.map(([, use]) => use("abc")));
