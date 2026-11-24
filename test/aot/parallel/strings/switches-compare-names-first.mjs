// A switch on what a property holds, and three and more comparisons of it with literals, outside loops: a name is told apart by its header, any other string by the stub's table.
// The subjects are names, strings allocated at run time, pieces of other strings, concatenations, wide strings, and values that are no strings. "0" and "" are no names: those chains compare one by one. The objects have several shapes, accessors and proxies.
// STATISTIC: StringSwitchesByTable >= 12
const atRunTime = (value) => [value][Math.min(0, process.pid)];
const out = [];
let state = 0;
function note(number) {
  state = (state * 31 + number) | 0;
  return number;
}

function three(node) {
  const x = node.type;
  if (x === "GET") return note(1);
  if (x === "HEAD") return note(2);
  if (x === "POST") return note(3);
  return note(-1);
}

function either(node) {
  const x = node.type;
  return (x === "VariableDeclaration" || x === "FunctionDeclaration" || x === "VariableDeclarator_") ? note(4) : note(-2);
}

function neither(node) {
  const x = node.type;
  if (x !== "add" && x !== "sub" && x !== "mul" && x !== "a longer name than the others") return note(5);
  return note(-3);
}

function knownString(node) {
  const x = node.type;
  if (typeof x !== "string") return note(-4);
  return x == "left" ? note(6) : x == "right" ? note(7) : x == "center" ? note(8) : note(x.length);
}

function repeated(node) {
  const x = node.type;
  if (x === "one") return note(9);
  if (x === "two") return note(10);
  if (x === "one") return note(11);
  if (x === "abcdefghijklmnopqrstuvwx") return note(12);
  return note(-5);
}

function byOneCharacter(node) {
  const x = node.type;
  if (x === "abcdefgh") return note(13);
  if (x === "abcdefghi") return note(14);
  if (x === "abcdefg") return note(15);
  if (x === "toString") return note(16);
  if (x === "__proto__") return note(17);
  if (x === "constructor") return note(18);
  return note(-6);
}

function ofSeventeen(node) {
  const x = node.type;
  let name = "?";
  if (x === "a") name = "0";
  else if (x === "ab") name = "1";
  else if (x === "abc") name = "2";
  else if (x === "abcd") name = "3";
  else if (x === "abcde") name = "4";
  else if (x === "abcdef") name = "5";
  else if (x === "abcdefg") name = "6";
  else if (x === "abcdefgh") name = "7";
  else if (x === "abcdefghi") name = "8";
  else if (x === "one") name = "9";
  else if (x === "two") name = "10";
  else if (x === "three") name = "11";
  else if (x === "four") name = "12";
  else if (x === "GET") name = "13";
  else if (x === "HEAD") name = "14";
  else if (x === "POST") name = "15";
  else if (x === "OPTIONS") name = "16";
  return name + note(19);
}

function withIndex(node) {
  const x = node.type;
  return x === "0" ? note(20) : x === "a" ? note(21) : x === "ab" ? note(22) : note(-7);
}

function withEmpty(node) {
  const x = node.type;
  return x === "" ? note(23) : x === "abc" ? note(24) : x === "abcd" ? note(25) : note(-8);
}

function withAccents(node) {
  const x = node.type;
  return x === "\u00e9" ? note(26) : x === "caf\u00e9" ? note(27) : x === "x" ? note(28) : note(-9);
}

function afterOther(node, y) {
  const x = node.type;
  if (x === "outer") return y === "outer" ? note(29) : y === "inner" ? note(30) : y === "x" ? note(31) : note(-10);
  if (y === 1) return note(32);
  if (x === "inner") return note(33);
  return note(-11);
}

function switched(node) {
  switch (node.type) {
    case "GET": return note(40);
    case "VariableDeclaration": return note(41);
    case "a longer name than the others": return note(42);
    case "toString": return note(43);
    case "constructor": return note(44);
    default: return note(-13);
  }
}

function switchedWithFall(node) {
  let sum = 0;
  switch (node.type) {
    case "one": sum += 1;
    case "two": sum += 2; break;
    default: sum += 100;
    case "three": sum += 3;
    case "four": sum += 4;
  }
  return note(sum);
}

function switchedToConstants(node) {
  switch (node.type) {
    case "string": return "s";
    case "number": return "n";
    case "boolean": return "b";
    case "undefined": return "u";
    case "function": return "f";
    case "object": return "o";
  }
  return "?";
}

function switchedWithIndex(node) {
  switch (node.type) {
    case "0": return note(50);
    case "a": return note(51);
    case "": return note(52);
    case "abc": return note(53);
  }
  return note(-14);
}

function switchedTwice(node) {
  switch (node.type) {
    case "outer":
      switch (node.kind) {
        case "outer": return note(60);
        case "inner": return note(61);
        case "GET": return note(62);
      }
      return note(63);
    case "inner": return note(64);
    case "left": return note(65);
  }
  return note(-15);
}

function thrown(node) {
  const x = node.type;
  try {
    if (x === "string") throw new Error("s");
    if (x === "number") throw new Error("n");
    if (x === "boolean") throw new Error("b");
  } catch (error) {
    return note(34) + error.message;
  }
  return note(-12);
}

const words = ["", "0", "1", "a", "ab", "abc", "abcd", "abcde", "abcdef", "abcdefg", "abcdefgh", "abcdefghi", "abcdefghijklmnop", "abcdefghijklmnopq", "abcdefghijklmnopqrstuvwx", "VariableDeclaration", "FunctionDeclaration",
  "VariableDeclarator_", "VariableDeclaratioN", "variableDeclaration", "VariableDeclxration", "é", "café", "\0", "a\0", "éééééééééé", "one", "two", "three", "four", "string", "number", "boolean", "undefined", "function",
  "object", "GET", "HEAD", "POST", "OPTIONS", "add", "sub", "mul", "a longer name than the others", "left", "right", "center", "outer", "inner", "x", "toString", "constructor", "__proto__"];
const wide = (text) => ("Ā" + text).slice(1);
const functions = [three, either, neither, knownString, repeated, byOneCharacter, ofSeventeen, withIndex, withEmpty, withAccents, (x) => afterOther(x, "inner"), (x) => afterOther({ type: "outer" }, x.type), (x) => afterOther(x, 1), thrown, switched, switchedWithFall, switchedToConstants, switchedWithIndex, switchedTwice, (x) => switchedTwice({ type: "outer", kind: x.type })];
const subjects = [];
const line = atRunTime("a line that is long enough for its pieces to share its characters|" + words.join("|"));
let at = line.indexOf("|") + 1;
for (const word of words) {
  const half = word.length >> 1;
  subjects.push(line.slice(at, at + word.length), line.slice(at - 1, at + word.length), wide(line).substring(at, at + word.length));
  at += word.length + 1;
  // Another character at one place.
  for (const place of [0, 1, 2, half, 9, 12, word.length - 1]) {
    if (place >= 0 && place < word.length) subjects.push(atRunTime(word.slice(0, place) + "~" + word.slice(place + 1)));
  }
  subjects.push(word, atRunTime(word), JSON.parse(JSON.stringify(word)), atRunTime(word.slice(0, half)) + atRunTime(word.slice(half)), ("##" + atRunTime(word) + "##").slice(2, 2 + word.length), wide(word), wide(word.slice(0, 1)) + word.slice(1),
    word + "x", word.slice(1), word.toUpperCase(), word + "Ā", word + "\0", "x".repeat(300) + word);
}
subjects.push(undefined, null, 0, 1, -0, NaN, 1.5, true, false, 1n, Symbol.iterator, {}, [], ["a"], () => "a", new String("a"), { toString: () => "a" }, new Date(0));
class Node { constructor(type) { this.start = 0; this.type = type; } }
const objects = [(type) => ({ type }), (type) => new Node(type), (type) => ({ kind: type, type }), (type) => ({ get type() { return type; } }), (type) => Object.create({ type }), (type) => new Proxy({ type }, {})];
subjects.forEach((subject, index) => {
  functions.forEach((f, place) => out.push(String(f(objects[(index + place) % 7 % objects.length](subject)))));
});
const of = objects[0];
out.push(three(of("HEAD")), either(of("VariableDeclaration")), neither(of("mul")), repeated(of("two")), ofSeventeen(of("OPTIONS")), switched(of("GET")), state);
console.log(out.length, Bun.hash(out.join("~")).toString(36), state);
console.log(out.slice(0, 200).join(" "));
