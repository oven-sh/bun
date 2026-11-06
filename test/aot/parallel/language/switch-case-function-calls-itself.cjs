"use strict";
function format(code, message) {
  switch (code) {
    case 1:
      const first = message.length;
      if (first > 9) return "long";
      function items(indent, next) {
        let result = "";
        for (const item of next) {
          result += " ".repeat(indent) + item.text;
          result += items(indent + 1, item.next);
        }
        return result;
      }
      const found = message.match(/a(.)/);
      if (found) {
        let main = "found " + found[1];
        if (message.length) main += items(1, [{ text: "x", next: [{ text: "y", next: [] }] }]);
        return main;
      }
      break;
    case 2:
      return "two";
  }
  return "none";
}
console.log(format(1, "ab"), "|", format(1, "zz"), "|", format(2, ""), "|", format(3, ""));
