// The five trim methods of strings are left out of the lock of String.prototype, because core-js 2 replaces them when it loads. A program that replaces one sees its own function at every call, on a literal, on a value of unknown type and through the alias. language/string-prototype-keeps-its-members has what stays fixed.
function trimmed(value) { return value.trim(); }
console.log("before: [" + [" a ".trim(), trimmed(" b "), " c".trimStart(), "d ".trimEnd(), " e".trimLeft(), "f ".trimRight()].join("|") + "]", "".trimLeft === "".trimStart, "".trimRight === "".trimEnd);

const whitespace = /^[\s᠎]+|[\s᠎]+$/g;
String.prototype.trim = function trim() { return String(this).replace(whitespace, ""); };
Object.defineProperty(String.prototype, "trimStart", { value() { return "start:" + this; }, writable: true, configurable: true });
String.prototype.trimRight = function () { return "right:" + this; };

console.log("after: [" + [" ᠎a᠎ ".trim(), trimmed("᠎b"), " c".trimStart(), "d ".trimEnd(), " e".trimLeft(), "f ".trimRight()].join("|") + "]", "".trimLeft === "".trimStart, "".trimRight === "".trimEnd);
console.log("by a computed name: " + ["trim", "trimStart", "trimEnd"].map(name => "[" + " x "[name]() + "]").join(" "));
console.log("what does not look at the methods: [" + [Number(" 1 "), parseInt(" 2 "), parseFloat(" 3.5 ")].join("|") + "]");
