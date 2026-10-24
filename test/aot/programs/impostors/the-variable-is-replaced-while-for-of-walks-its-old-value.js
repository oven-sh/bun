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

function replacedText(replacement) {
  let text = "abc";
  const seen = [];
  for (const character of text) {
    seen.push(character);
    text = replacement;
  }
  return [seen, text];
}

function appendedText() {
  let text = "ab";
  const seen = [];
  for (const character of text) {
    seen.push(character);
    if (text.length < 10) text += character;
  }
  return [seen, text];
}

function replacedByACall(change) {
  const holder = { text: "abc" };
  const seen = [];
  for (const character of holder.text) {
    seen.push(character);
    change(holder);
  }
  return [seen, holder.text];
}

function walkAndIndex(value) {
  const seen = [];
  let i = 0;
  for (const item of value) {
    seen.push([item, value[i], item === value[i]]);
    i++;
  }
  return seen;
}

function grownList(list) {
  const seen = [];
  for (const item of list) {
    seen.push(item);
    if (list.length < 5) list.push(item + "!");
  }
  return seen;
}

function shrunkList(list) {
  const seen = [];
  for (const item of list) {
    seen.push(item);
    list.pop();
  }
  return seen;
}

function spreadWhileConverting(parts) {
  return [...parts[0], ...parts[1]];
}

function nestedOverTheSameText(text) {
  const seen = [];
  for (const a of text) for (const b of text) seen.push(a + b);
  return seen;
}

for (let i = 0; i < 2000; i++) {
  replacedText("xyz");
  appendedText();
  replacedByACall(() => {});
  walkAndIndex("abc");
  grownList(["a"]);
  shrunkList(["a", "b"]);
  nestedOverTheSameText("ab");
}

for (const text of ["'xyz'", "''", "['x', 'y', 'z', 'w']", "5", "null", "new String('xyz')"]) {
  attempt("the variable becomes " + text, () => replacedText(make(text)));
  attempt("the member becomes " + text, () => replacedByACall(holder => { holder.text = make(text); }));
}
attempt("the variable is appended to", appendedText);
for (const text of ["'abc'", "'\\ud83d\\ude00x'", "'x\\ud83d'", "['a', 'b']", "['a', , 'b']", "new String('ab')", "new Set(['a', 'b'])", "new Map([[0, 'a']])", "Buffer.from('ab')", "(function () { return arguments; })('a', 'b')", "(function* () { yield 'a'; })()"]) {
  attempt("walked and indexed: " + text, () => walkAndIndex(make(text)));
  attempt("nested over " + text, () => nestedOverTheSameText(make(text)));
}
attempt("a list grows while it is walked", () => grownList(["a"]));
attempt("a list shrinks while it is walked", () => shrinkOrNot());
function shrinkOrNot() {
  return [shrunkList(["a", "b", "c", "d"]), shrunkList(["a"]), shrunkList([])];
}
attempt("a text cannot grow while it is walked", () => grownList("ab"));
attempt("a set grows while it is walked", () => {
  const set = new Set(["a"]);
  const seen = [];
  for (const item of set) {
    seen.push(item);
    if (set.size < 4) set.add(item + "!");
  }
  return seen;
});
attempt("the second spread is changed by the iterator of the first", () => {
  const parts = [null, "cd"];
  parts[0] = { *[Symbol.iterator]() { yield "a"; parts[1] = ["changed"]; yield "b"; } };
  return spreadWhileConverting(parts);
});

console.log("bytes made in plain sight", Buffer.from("he").length);
