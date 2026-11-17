// Methods of built-in classes make functions as strings and assign them: the strings that the file's constants lead to are compiled, the others are interpreted, and all do what the strings say.
Date.formatters = { count: 0 };
Date.weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
String.quoted = function (string) {
  return string.replace(/('|\\)/g, "\\$1");
};
Date.prototype.formatted = function (format) {
  if (Date.formatters[format] == null) Date.createFormatter(format);
  return this[Date.formatters[format]]();
};
Date.createFormatter = function (format) {
  var name = "formatter" + Date.formatters.count++;
  Date.formatters[format] = name;
  var code = "Date.prototype." + name + " = function () { return ";
  var special = false;
  for (var i = 0; i < format.length; ++i) {
    var ch = format.charAt(i);
    if (!special && ch == "\\") {
      special = true;
    } else if (special) {
      special = false;
      code += "'" + String.quoted(ch) + "' + ";
    } else {
      code += Date.codeOf(ch);
    }
  }
  lastOfEval = eval(code.substring(0, code.length - 3) + "; };;");
};
Date.codeOf = function (character) {
  switch (character) {
    case "D":
      return "Date.weekdays[this.getUTCDay()].substring(0, 3) + ";
    case "Y":
      return "this.getUTCFullYear() + ";
    case "m":
      return "(this.getUTCMonth() + 1) + ";
    case "f":
      return "format.length + ";
    default:
      return "'" + String.quoted(character) + "' + ";
  }
};
var lastOfEval;
var date = new Date(86400000 * 9999);
console.log(date.formatted("Y-m"), lastOfEval === Date.prototype.formatter0);
console.log(date.formatted("D, 'm\\Y\\\\ Y f"), lastOfEval.name === "", lastOfEval + "");
console.log(date.formatted("Y-m"), date.formatted(process.argv[7] ?? "m" + "/" + "Y"));
console.log(Object.keys(Date.formatters).join(" | "), Object.keys(Date.prototype).join());

// The assignment itself throws, a setter gets the function, and the place is a name of the function around.
Number.tries = [];
Number.define = function (place) {
  var frozen = Object.freeze({}), target = { set method(value) { Number.tries.push(typeof value); } };
  try {
    var made = eval(place + " = function () { return place; }");
    Number.tries.push(made());
  } catch (error) {
    Number.tries.push(error.constructor.name);
  }
};
Number.define("target.method");
Number.define("frozen.method");
Number.define("missing.method");
Number.define("target.a.b");
Number.define("Number.made");
console.log(Number.tries.join(), Number.made());
Number.define("Number" + ".made" + (process.argv.length > 90 ? "x" : ""));
console.log(Number.tries.join());

// Another eval, and texts that are no assignments of functions.
Array.prototype.evaluated = function (text) {
  return eval(text);
};
console.log([1, 2].evaluated("this.twice = function () { return this.length * 2; }")(), [3].evaluated("Array.kind = 5"), Array.kind);
console.log([4].evaluated("Array.first = function () { return 1; }, 2"), [5, 6, 7].evaluated("Array.second = (a) => a + this.length")(1), Array.second(2));
for (const name of ["formatted", "formatter0", "formatter1", "formatter2"]) delete Date.prototype[name];
delete Array.prototype.evaluated;
