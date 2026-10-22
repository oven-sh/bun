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

function makeChanging(answers) {
  let reads = 0;
  return {
    get value() {
      return answers[reads++ % answers.length];
    },
    get reads() {
      return reads;
    },
  };
}

function lengthAndFirst(holder) {
  return [holder.value.length, holder.value[0]];
}

function testThenUse(holder) {
  return typeof holder.value === "string" ? holder.value.toUpperCase() : "not a text";
}

function guardThenUse(holder) {
  return holder.value && holder.value.length;
}

function compareThenUse(holder) {
  if (holder.value !== "") return holder.value.charCodeAt(0);
  return "empty";
}

function loopOver(holder) {
  const seen = [];
  for (let i = 0; i < holder.value.length && i < 6; i++) seen.push(holder.value[i]);
  return seen;
}

function sameTwice(holder) {
  return holder.value === holder.value;
}

function concatenated(holder) {
  return holder.value + "|" + holder.value + "|" + holder.value;
}

function keyTwice(holder, table) {
  return [table[holder.value], table[holder.value]];
}

function savedOnce(holder) {
  const value = holder.value;
  return [typeof value, value.length, value[0], holder.reads];
}

const uses = [
  ["length and first", lengthAndFirst],
  ["test then use", testThenUse],
  ["guard then use", guardThenUse],
  ["compare then use", compareThenUse],
  ["loop over", loopOver],
  ["same twice", sameTwice],
  ["concatenated", concatenated],
  ["key twice", holder => keyTwice(holder, { abc: "by abc", "x,y": "by the list", 5: "by five", null: "by null" })],
  ["saved once", savedOnce],
];

for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use({ value: "abc", reads: 0 });
}

const sequences = [
  ["always a text", ["abc"]],
  ["a text, then a list", ["abc", ["x", "y"]]],
  ["a list, then a text", [["x", "y"], "abc"]],
  ["a text, then a number", ["abc", 5]],
  ["a text, then null", ["abc", null]],
  ["a text, then undefined", ["abc", undefined]],
  ["a text, then a wrapped text", ["abc", new String("abc")]],
  ["a text, then a longer text", ["abc", "abcdef"]],
  ["a text, then the empty text", ["abc", ""]],
  ["a text, then a look-alike", ["abc", { length: 1, 0: "L", toUpperCase: () => "LOOK", charCodeAt: () => "alike", toString: () => "alike" }]],
  ["three kinds", ["abc", ["x", "y"], 5]],
];

for (const [name, use] of uses) {
  for (const [label, answers] of sequences) {
    const holder = makeChanging(answers);
    attempt(name + ": " + label, () => use(holder));
    console.log("  reads:", holder.reads);
  }
}
