class Matcher { [Symbol.replace](text, by) { return text + by; } exec() { return null; } get flags() { return ""; } }
console.log("a".replace(new Matcher(), "b"), RegExp.prototype.test.call(new Matcher(), "x"));
