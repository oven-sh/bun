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

function escapeByCodes(value) {
  var text = "" + value;
  var found = /["'&<>]/.exec(text);
  if (!found) return text;
  var result = "";
  var last = 0;
  var index;
  for (index = found.index; index < text.length; index++) {
    var replacement;
    switch (text.charCodeAt(index)) {
      case 34:
        replacement = "&quot;";
        break;
      case 38:
        replacement = "&amp;";
        break;
      case 39:
        replacement = "&#39;";
        break;
      case 60:
        replacement = "&lt;";
        break;
      case 62:
        replacement = "&gt;";
        break;
      default:
        continue;
    }
    if (last !== index) result += text.substring(last, index);
    last = index + 1;
    result += replacement;
  }
  return last !== index ? result + text.substring(last, index) : result;
}

function escapeWithoutConverting(text) {
  var result = "";
  for (var i = 0; i < text.length; i++) {
    var character = text[i];
    if (character === "&") result += "&amp;";
    else if (character === "<") result += "&lt;";
    else if (character === ">") result += "&gt;";
    else result += character;
  }
  return result;
}

var entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeByTable(text) {
  return text.replace(/[&<>"']/g, function (character) {
    return entities[character];
  });
}

function escapeByChain(text) {
  return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
}

function escapeIfText(value) {
  return typeof value === "string" ? escapeByTable(value) : value;
}

function render(strings, ...values) {
  var result = strings[0];
  for (var i = 0; i < values.length; i++) result += escapeByCodes(values[i]) + strings[i + 1];
  return result;
}

var uses = [
  ["by codes", escapeByCodes],
  ["without converting", escapeWithoutConverting],
  ["by table", escapeByTable],
  ["by chain", escapeByChain],
  ["if text", escapeIfText],
  ["render", function (value) { return render`<p title="${value}">${value}</p>`; }],
];

var values = [
  "'a < b && c > \"d\"'",
  "'nothing to do'",
  "''",
  "'<'",
  "'\\u4e16<\\ud83d\\ude00>&'",
  "'a' + '<' + 'b'",
  "new String('<wrapped>')",
  "['<a>', '&']",
  "['<', ['>']]",
  "{ toString() { return '<object>'; } }",
  "{ length: 2, 0: '<', 1: 5 }",
  "{ length: 1, 0: '&', replace() { return 'own replace'; }, split() { return ['own', 'split']; } }",
  "5",
  "-0",
  "null",
  "undefined",
  "true",
  "Symbol('<s>')",
  "Buffer.from('<b>')",
  "new Uint8Array([60, 62])",
  "{}",
  "Object.create(null)",
];

var total = 0;
for (var i = 0; i < 2000; i++) {
  for (var j = 0; j < uses.length; j++) total += uses[j][1]('a < b && c > "d"').length;
}
console.log("2000 honest rounds", total);

uses.forEach(function (use) {
  values.forEach(function (text) {
    attempt(use[0] + " " + text, function () {
      var given = make(text);
      var result = use[1](given);
      return result === given && typeof given === "object" && given !== null ? "the same object" : result;
    });
  });
});

console.log("bytes made in plain sight", Buffer.from("he").length);
