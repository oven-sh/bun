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

function sliceIsEll(text) {
  return text.slice(1, 4) === "ell";
}

function substringIsEll(text) {
  return text.substring(1, 4) === "ell";
}

function characterIsE(text) {
  return text.charAt(1) === "e";
}

function elementIsE(text) {
  return text[1] === "e";
}

function codeIsE(text) {
  return text.charCodeAt(1) === 101;
}

function startsWithEllAtOne(text) {
  return text.startsWith("ell", 1);
}

function endIsLlo(text) {
  return text.slice(-3) === "llo";
}

function sliceLooselyEquals(text) {
  return text.slice(1, 2) == "e";
}

function sliceInASwitch(text) {
  switch (text.slice(0, 2)) {
    case "he":
      return "he";
    case "//":
      return "comment";
  }
  return "other";
}

function sliceAsAKey(text) {
  return { he: "by he", "h,e": "by a list", "104,101": "by bytes" }[text.slice(0, 2)];
}

function lengthOfSlice(text) {
  return text.slice(1, 4).length;
}

function sliceOfSlice(text) {
  return text.slice(1).slice(1).slice(0, 1);
}

function trimmedIsEmpty(text) {
  return text.trim() === "";
}

function lowerIsHello(text) {
  return text.toLowerCase() === "hello";
}

function receivers(name) {
  return [
    "'hello world'",
    "''",
    "'hello'.concat(' ', 'world')",
    "'h\\u00e9llo w\\u4e16rld'",
    "'\\ud83d\\ude00 \\ud83d alone'",
    "new String('hello world')",
    "Object.assign(new String('hello world'), { " + name + "() { return 'own member'; } })",
    "Object.setPrototypeOf(new String('hello world'), { " + name + "() { return 'other prototype'; } })",
    "Object.setPrototypeOf(new String('hello world'), null)",
    "{ " + name + "(...given) { return 'mine ' + given.length; } }",
    "{ " + name + ": String.prototype." + name + ", toString() { return 'borrowed method'; } }",
    "{ " + name + ": 5 }",
    "{}",
    "['h', 'e', 'l', 'l', 'o', ' ', 'w']",
    "Buffer.from('hello world')",
    "new Uint8Array([104, 101, 108, 108, 111])",
    "12345",
    "-0",
    "12345n",
    "Symbol('hello')",
    "true",
    "null",
    "undefined",
    "new Proxy(new String('hello world'), {})",
    "new Proxy({}, { get(target, key) { return () => 'trapped ' + String(key); } })",
  ];
}

const uses = [
  ["slice", "slice is ell", sliceIsEll],
  ["substring", "substring is ell", substringIsEll],
  ["charAt", "character is e", characterIsE],
  ["at", "element is e", elementIsE],
  ["charCodeAt", "code is e", codeIsE],
  ["startsWith", "starts with ell at one", startsWithEllAtOne],
  ["slice", "end is llo", endIsLlo],
  ["slice", "slice loosely equals", sliceLooselyEquals],
  ["slice", "slice in a switch", sliceInASwitch],
  ["slice", "slice as a key", sliceAsAKey],
  ["slice", "length of slice", lengthOfSlice],
  ["slice", "slice of slice", sliceOfSlice],
  ["trim", "trimmed is empty", trimmedIsEmpty],
  ["toLowerCase", "lower is hello", lowerIsHello],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, , use] of uses) total += String(use("hello")).length;
}
console.log("2000 honest rounds", total);

function outcome(use, text) {
  try {
    return show(use(make(text)));
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const [member, name, use] of uses) {
  const list = receivers(member);
  for (let from = 0; from < list.length; from += 5) {
    console.log(name + ": " + list.slice(from, from + 5).map(text => outcome(use, text)).join("; "));
  }
  console.log(name + " of look-alikes whose pieces are not texts: " + [
    "{ " + member + "() { return new String('ell'); } }",
    "{ " + member + "() { return ['ell']; } }",
    "{ " + member + "() { return { toString() { return 'ell'; }, length: 3, slice() { return this; } }; } }",
    "{ " + member + "() { return 101; } }",
    "{ " + member + "() { return null; } }",
  ].map(text => outcome(use, text)).join("; "));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
