// In the manner of the package colors: one getter on String.prototype for each style, defined with __defineGetter__. One of the names, bold, is a method that String.prototype has from the start.
const codes = { reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], red: [31, 39], green: [32, 39], bgBlue: [44, 49] };
function stylize(text, style) { return "<" + codes[style][0] + ">" + text + "</" + codes[style][1] + ">"; }

const hadBold = typeof String.prototype.bold;
for (const style of Object.keys(codes)) {
  String.prototype.__defineGetter__(style, function () { return stylize(this, style); });
}

function paint(text) { return text.red.bold; }
console.log([hadBold, "a".red, "a".bold, "a".green.underline, paint("b"), `x${1}`.dim, new String("c").bgBlue, typeof "a".bold, "a".italic, typeof "a".italics].join(" "));
console.log([typeof String.prototype.__lookupGetter__("bold"), typeof Object.getOwnPropertyDescriptor(String.prototype, "bold").get, Object.keys(String.prototype).sort().join(), "abc".toUpperCase(), "a-b".split("-").length].join(" "));
