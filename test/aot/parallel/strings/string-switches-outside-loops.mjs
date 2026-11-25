// A chain of six and more comparisons with literals outside loops, and a switch on strings in code that runs once: a stub tells by a table which case it is, whatever their number and length.
// Beside them are switches and shorter chains, which do without the table.
// The subjects are names, strings allocated at run time, pieces of other strings, concatenations, wide strings, and values that are no strings.
// STATISTIC: StringSwitchesByTable >= 5
const atRunTime = (value) => [value][Math.min(0, process.pid)];
const out = [];
let state = 0;
function note(number) {
  state = (state * 31 + number) | 0;
  return number;
}

function byLength(x) {
  switch (x) {
    case "a": return note(1);
    case "ab": return note(2);
    case "abc": return note(3);
    case "abcd": return note(4);
    case "abcde": return note(5);
    case "abcdef": return note(6);
    case "abcdefg": return note(7);
    case "abcdefgh": return note(8);
    case "abcdefghi": return note(9);
    case "abcdefghijklmnop": return note(16);
    case "abcdefghijklmnopq": return note(17);
    case "abcdefghijklmnopqrstuvwx": return note(24);
    default: return note(-1);
  }
}

function sameLength(x) {
  switch (x) {
    case "VariableDeclaration": return note(1);
    case "FunctionDeclaration": return note(2);
    case "VariableDeclarator_": return note(3);
    case "VariableDeclaratioN": return note(4);
    case "variableDeclaration": return note(5);
    case "VariableDeclxration": return note(6);
  }
  return note(-2);
}

function withEmptyAndAccents(x) {
  switch (x) {
    case "": return note(10);
    case "é": return note(11);
    case "café": return note(12);
    case "\0": return note(13);
    case "a\0": return note(14);
    case "a": return note(15);
    case "éééééééééé": return note(16);
    default: return note(-3);
  }
}

function fallsThrough(x) {
  let sum = 0;
  switch (x) {
    case "one": sum += 1;
    case "two": sum += 2; break;
    default: sum += 100;
    case "three": sum += 3;
    case "four": sum += 4;
  }
  return note(sum);
}

function constants(x) {
  switch (x) {
    case "string": return "s";
    case "number": return "n";
    case "boolean": return "b";
    case "undefined": return "u";
    case "function": return "f";
    case "object": return "o";
  }
  return "?";
}

function chain(x) {
  if (x === "GET") return note(20);
  if (x === "HEAD") return note(21);
  if (x === "POST") return note(22);
  if (x === "GET") return note(23);
  if (x === "OPTIONS") return note(24);
  return note(-4);
}

function either(x) {
  return x === "add" || x === "sub" || x === "mul" || x === "a longer name than the others";
}

function neither(x) {
  if (x !== "add" && x !== "sub" && x !== "mul") return note(30);
  return note(31);
}

function knownString(x) {
  if (typeof x !== "string") return note(-5);
  switch (x) {
    case "left": return note(40);
    case "right": return note(41);
    case "center": return note(42);
  }
  return note(x.length);
}

function nested(x, y) {
  switch (x) {
    case "outer":
      switch (y) {
        case "outer": return note(50);
        case "inner": return note(51);
      }
      return note(52);
    case "inner":
      return note(53);
  }
  return note(54);
}

function chainByLength(x) {
  if (x === "a") return note(1);
  else if (x === "ab") return note(2);
  else if (x === "abc") return note(3);
  else if (x === "abcd") return note(4);
  else if (x === "abcde") return note(5);
  else if (x === "abcdefg") return note(7);
  else if (x === "abcdefgh") return note(8);
  else if (x === "abcdefghi") return note(9);
  else if (x === "abcdefghijklmnop") return note(16);
  else if (x === "abcdefghijklmnopq") return note(17);
  else if (x === "abcdefghijklmnopqrstuvwx") return note(24);
  return note(-1);
}

function chainOfSameLength(x) {
  if (x === "VariableDeclaration") return note(1);
  if (x === "FunctionDeclaration") return note(2);
  if (x === "VariableDeclarator_") return note(3);
  if (x === "VariableDeclaratioN") return note(4);
  if (x === "variableDeclaration") return note(5);
  if (x === "VariableDeclxration") return note(6);
  return note(-2);
}

function chainWithEmpty(x) {
  return x === "" ? note(10) : x === "\0" ? note(13) : x === "a\0" ? note(14) : x === "a" ? note(15) : x === "GET" ? note(16) : x === "HEAD" ? note(17) : x === "" ? note(18) : note(-3);
}

function chainOfConstants(x) {
  let name;
  if (x === "string") name = "s";
  else if (x === "number") name = "n";
  else if (x === "boolean") name = "b";
  else if (x === "undefined") name = "u";
  else if (x === "function") name = "f";
  else if (x === "object") name = "o";
  else if (x === "\u0100wide") name = "w";
  else name = "?";
  return name + note(3);
}

function chainOfKnownString(x) {
  if (typeof x !== "string") return note(-5);
  if (x == "left") return note(40);
  if (x == "right") return note(41);
  if (x == "center") return note(42);
  if (x == "outer") return note(43);
  if (x == "inner") return note(44);
  if (x == "add") return note(45);
  return note(x.length);
}

const words = ["", "a", "ab", "abc", "abcd", "abcde", "abcdef", "abcdefg", "abcdefgh", "abcdefghi", "abcdefghijklmnop", "abcdefghijklmnopq", "abcdefghijklmnopqrstuvwx", "VariableDeclaration", "FunctionDeclaration",
  "VariableDeclarator_", "VariableDeclaratioN", "variableDeclaration", "VariableDeclxration", "é", "café", "\0", "a\0", "éééééééééé", "one", "two", "three", "four", "string", "number", "boolean", "undefined", "function",
  "object", "GET", "HEAD", "POST", "OPTIONS", "add", "sub", "mul", "a longer name than the others", "left", "right", "center", "outer", "inner", "x", "toString", "constructor", "__proto__"];
const wide = (text) => ("Ā" + text).slice(1);
const functions = [chainByLength, chainOfSameLength, chainWithEmpty, chainOfConstants, chainOfKnownString, byLength, sameLength, withEmptyAndAccents, fallsThrough, constants, chain, either, neither, knownString, (x) => nested(x, "inner"), (x) => nested("outer", x)];
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
for (const subject of subjects) {
  for (const f of functions) out.push(String(f(subject)));
}
out.push(byLength("abcdefghi"), sameLength("VariableDeclaratioN"), constants("function"), chain("OPTIONS"), either("mul"), state);
console.log(out.length, Bun.hash(out.join("~")).toString(36), state);
console.log(out.slice(0, 200).join(" "));
