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

function codesWhileTheVariableChanges(replacement, when) {
  let text = "abcdef";
  const seen = [];
  for (let i = 0; i < text.length && i < 8; i++) {
    seen.push(text.charCodeAt(i));
    if (i === when) text = replacement;
  }
  return seen;
}

function elementsWhileTheVariableChanges(replacement, when) {
  let text = "abcdef";
  const seen = [];
  for (let i = 0; i < text.length && i < 8; i++) {
    seen.push(text[i]);
    if (i === when) text = replacement;
  }
  return seen;
}

function codesWhileACallbackRuns(holder, callback) {
  const seen = [];
  for (let i = 0; i < holder.text.length && i < 8; i++) {
    seen.push(holder.text.charCodeAt(i));
    callback(holder, i);
  }
  return seen;
}

function codesOfAWrappedText(text, callback) {
  const seen = [];
  for (let i = 0; i < text.length && i < 8; i++) {
    seen.push(text.charCodeAt(i));
    callback(text, i);
  }
  return seen;
}

function elementsPastTheEnd(text, callback) {
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(text[i]);
    callback(i);
  }
  return seen;
}

function lengthsOfAList(texts, callback) {
  const seen = [];
  for (let i = 0; i < texts.length; i++) {
    callback(texts, i);
    seen.push(texts[i].length);
  }
  return seen;
}

for (let i = 0; i < 2000; i++) {
  codesWhileTheVariableChanges("ghijkl", 2);
  elementsWhileTheVariableChanges("ghijkl", 2);
  codesWhileACallbackRuns({ text: "abc" }, () => {});
  codesOfAWrappedText("abc", () => {});
  elementsPastTheEnd("abc", () => {});
  lengthsOfAList(["a", "bc"], () => {});
}

const replacements = [
  "'ghijkl'",
  "'\\u4e16\\u754c\\u4eba\\u4eec\\u597d\\u5417'",
  "'gh'",
  "new String('ghijkl')",
  "['g', 'h', 'i', 'j', 'k', 'l']",
  "{ length: 6, charCodeAt(i) { return 'look alike ' + i; }, 3: 'third', 4: 'fourth' }",
  "Buffer.from('ghijkl')",
  "123456",
  "null",
  "{ length: Infinity, charCodeAt(i) { return -i; } }",
];

for (const text of replacements) {
  attempt("codes, the variable becomes " + text, () => codesWhileTheVariableChanges(make(text), 2));
  attempt("elements, the variable becomes " + text, () => elementsWhileTheVariableChanges(make(text), 2));
  attempt("codes, a member becomes " + text, () => codesWhileACallbackRuns({ text: "abcdef" }, (holder, i) => { if (i === 2) holder.text = make(text); }));
  attempt("lengths, a later element becomes " + text, () => lengthsOfAList(["a", "bc", "def", "ghij"], (texts, i) => { if (i === 1) texts[2] = make(text); }));
}

attempt("a wrapped text gets a method of its own", () => codesOfAWrappedText(new String("abcdef"), (text, i) => { if (i === 2) text.charCodeAt = () => "own"; }));
attempt("a wrapped text gets another prototype", () => codesOfAWrappedText(new String("abcdef"), (text, i) => { if (i === 2) Object.setPrototypeOf(text, { charCodeAt: () => "other prototype" }); }));
attempt("a wrapped text loses its prototype", () => codesOfAWrappedText(new String("abcdef"), (text, i) => { if (i === 2) Object.setPrototypeOf(text, null); }));
attempt("a wrapped text gets a prototype between", () => codesOfAWrappedText(new String("abcdef"), (text, i) => { if (i === 2) Object.setPrototypeOf(text, Object.create(String.prototype, { charCodeAt: { value: () => "between" } })); }));
attempt("an index past the end appears on a prototype between", () => {
  const between = Object.create(String.prototype);
  return elementsPastTheEnd(Object.setPrototypeOf(new String("abc"), between), i => { if (i === 3) between[4] = "inherited from the prototype between"; });
});
attempt("an index past the end appears on the wrapped text itself", () => {
  const text = new String("abc");
  return elementsPastTheEnd(text, i => { if (i === 3) text[5] = "own"; });
});
attempt("afterwards nothing is inherited", () => elementsPastTheEnd("abc", () => {}));
attempt("the list is shortened", () => lengthsOfAList(["a", "bc", "def"], (texts, i) => { if (i === 1) texts.length = 2; }));
attempt("an element is deleted", () => lengthsOfAList(["a", "bc", "def"], (texts, i) => { if (i === 1) delete texts[2]; }));
attempt("an element becomes a getter", () => lengthsOfAList(["a", "bc", "def"], (texts, i) => { if (i === 1) Object.defineProperty(texts, 2, { get: () => ({ length: "from a getter" }) }); }));

console.log("bytes made in plain sight", Buffer.from("he").length);
