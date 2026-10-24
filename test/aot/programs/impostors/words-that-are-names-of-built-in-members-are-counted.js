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

const words = make("'the constructor of the prototype has a length and a name toString valueOf __proto__ hasOwnProperty constructor length the __proto__ 0 1 00 -0 1 isPrototypeOf __defineGetter__ __lookupSetter__'.split(' ')");

function countInAnObject(list) {
  const counts = {};
  for (const word of list) counts[word] = (counts[word] || 0) + 1;
  return counts;
}

function countWithIn(list) {
  const counts = {};
  for (const word of list) {
    if (word in counts) counts[word]++;
    else counts[word] = 1;
  }
  return counts;
}

function countWithHasOwn(list) {
  const counts = {};
  for (const word of list) {
    if (Object.hasOwn(counts, word)) counts[word]++;
    else counts[word] = 1;
  }
  return counts;
}

function countWithoutAPrototype(list) {
  const counts = Object.create(null);
  for (const word of list) counts[word] = (counts[word] || 0) + 1;
  return counts;
}

function countInAMap(list) {
  const counts = new Map();
  for (const word of list) counts.set(word, (counts.get(word) || 0) + 1);
  return Object.fromEntries(counts);
}

function countInAList(list) {
  const counts = [];
  for (const word of list) counts[word] = (counts[word] || 0) + 1;
  return counts;
}

function countInAFunction(list) {
  const counts = function counter(a, b) {};
  for (const word of list) {
    try {
      counts[word] = (counts[word] || 0) + 1;
    } catch (error) {
      counts["failed " + word] = error.constructor.name;
    }
  }
  return counts;
}

function groupByFirstLetter(list) {
  const groups = {};
  for (const word of list) (groups[word[0]] ||= []).push(word);
  return groups;
}

function print(label, counts) {
  const parts = [];
  for (const key of Reflect.ownKeys(counts)) {
    const value = counts[key];
    parts.push(JSON.stringify(key) + "=" + (typeof value === "string" && value.length > 30 ? "a long text" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)));
  }
  console.log(label + ": " + parts.join(" "));
  const prototype = Object.getPrototypeOf(counts);
  console.log(label + " prototype: " + (prototype === null ? "null" : prototype === Object.prototype ? "Object.prototype" : prototype === Array.prototype ? "Array.prototype" : prototype === Function.prototype ? "Function.prototype" : "other"));
}

const honest = ["x", "y", "x", "z"];
for (let i = 0; i < 2000; i++) {
  countInAnObject(honest);
  countWithIn(honest);
  countWithHasOwn(honest);
  countWithoutAPrototype(honest);
  countInAMap(honest);
  groupByFirstLetter(honest);
}

print("in an object", countInAnObject(words));
print("with in", countWithIn(words));
print("with hasOwn", countWithHasOwn(words));
print("without a prototype", countWithoutAPrototype(words));
print("in a map", countInAMap(words));
const list = countInAList(words);
print("in a list", list);
console.log("the list has length", list.length, Array.isArray(list));
print("in a function", countInAFunction(words));
print("groups", groupByFirstLetter(words));
print("honest again", countInAnObject(honest));
