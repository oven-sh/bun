// Prints the code units of strings that hold octal escapes, `\8` and `\9`, in sloppy and in strict functions, as property names and in a directive.
function unitsOf(text) {
  return Array.from(text, unit => unit.charCodeAt(0)).join(" ");
}

function strict() {
  "use strict";
  return ["\033[0m", "\1a", "\12b", "\123", "\8", "\9"];
}

function afterDirective() {
  "\1a";
  return "\7.";
}

const texts = [
  "\033[0m",
  '\033[31m',
  "\1a",
  "\7 ",
  "\12b",
  "\77-",
  "\101",
  "\377",
  "\3778",
  "\400",
  "\477",
  "\0001",
  "\1\2\3.",
  "\4'",
  '\4"',
  "\4\"",
  "\4\\",
  "\4\n",
  "\0",
  "\0a",
  "\8",
  "\9",
  "\89",
  "a\8b\9c",
];
for (const text of [...texts, ...strict(), afterDirective()]) console.log(text.length, unitsOf(text));

const named = { "\1a": 1, "\101": 2, "\8": 3 };
console.log(Object.keys(named).map(unitsOf).join(", "), named.A, named[8]);

class Named {
  "\102"() {
    return "\103";
  }
  static "\9" = "\104";
}
console.log(new Named().B(), Named[9]);

switch ("\105") {
  case "E":
    console.log("\106" === "F", typeof "\107");
}
