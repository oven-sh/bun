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

function isDigit(character) {
  return character >= "0" && character <= "9";
}

function isLetter(character) {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z") || character === "_";
}

function isSpace(character) {
  return character === " " || character === "\t" || character === "\n";
}

function digitValue(character) {
  return character.charCodeAt(0) - 48;
}

function tokenize(source) {
  var tokens = [];
  var i = 0;
  var guard = 0;
  while (i < source.length && guard++ < 100) {
    var character = source[i];
    if (isSpace(character)) {
      i++;
    } else if (isDigit(character)) {
      var number = 0;
      while (isDigit(source[i])) number = number * 10 + digitValue(source[i++]);
      tokens.push("number " + number);
    } else if (isLetter(character)) {
      var start = i;
      while (isLetter(source[i]) || isDigit(source[i])) i++;
      tokens.push("name " + source.slice(start, i));
    } else if (character === '"') {
      var text = "";
      i++;
      while (source[i] !== '"' && source[i] !== undefined) text += source[i++];
      i++;
      tokens.push("text " + text);
    } else {
      tokens.push("sign " + character);
      i++;
    }
  }
  return tokens;
}

var total = 0;
for (var i = 0; i < 2000; i++) total += tokenize('let x1 = 42 + "hi"').length;
console.log("2000 honest rounds", total);

var characters = ["'5'", "'a'", "' '", "''", "'55'", "'ab'", "'\\u0665'", "'\\u00e9'", "5", "0", "9.5", "-1", "undefined", "null", "true", "NaN", "[5]", "['a']", "[]", "new String('5')", "new String('a')", "{ valueOf() { return 5; } }", "{ toString() { return 'a'; } }", "5n", "Symbol('5')"];
characters.forEach(function (text) {
  attempt("classes of " + text, function () {
    var value = make(text);
    return [isDigit(value), isLetter(value), isSpace(value)];
  });
  attempt("digit value of " + text, function () { return digitValue(make(text)); });
});

var sources = [
  "'let x1 = 42 + \"hi\"'",
  "'42'",
  "'x'",
  "'\"never closed'",
  "''",
  "'a\\u00e9b \\u4e16 \\ud83d\\ude00'",
  "'1' + '2 ' + 'ab'",
  "new String('a 1')",
  "['a', 'b', ' ', '1', '2']",
  "['ab', '12', ' ', '\"', 'x', '\"']",
  "[1, 2, ' ', 'a']",
  "['a', , 'b']",
  "['1', null, undefined, true]",
  "Buffer.from('a 1')",
  "new Uint8Array([1, 2])",
  "{ length: 3, 0: 'a', 1: '1', 2: ' ', slice(from, to) { return 'slice ' + from + ' ' + to; } }",
  "{ length: 2, 0: '1', 1: { charCodeAt() { return 50; }, valueOf() { return '5'; } } }",
  "(function () { return arguments; })('1', '2')",
  "5",
  "null",
  "undefined",
];
sources.forEach(function (text) {
  attempt("tokens of " + text, function () { return tokenize(make(text)); });
});
attempt("honest again", function () { return tokenize('let x1 = 42 + "hi"'); });

console.log("bytes made in plain sight", Buffer.from("he").length);
