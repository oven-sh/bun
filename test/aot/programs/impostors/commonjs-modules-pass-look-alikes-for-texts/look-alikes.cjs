function LookAlike(text) {
  this.text = text;
  this.length = text.length;
}

LookAlike.prototype.charCodeAt = function (index) {
  return -this.text.charCodeAt(index);
};

LookAlike.prototype.charAt = function (index) {
  return new LookAlike(this.text.charAt(index));
};

LookAlike.prototype.toUpperCase = function () {
  return "<" + this.text.toUpperCase() + ">";
};

LookAlike.prototype.slice = function (from) {
  return "<" + this.text.slice(from) + ">";
};

LookAlike.prototype.toString = function () {
  return "look alike " + this.text;
};

module.exports = {
  lookAlike: new LookAlike("hello"),
  wrapped: new String("hello"),
  list: ["h", "e", "l", "l", "o"],
  bytes: Buffer.from("hello"),
  number: 12345,
  nothing: null,
  missing: undefined,
  symbol: Symbol("hello"),
  proto: "__proto__",
  constructorName: "constructor",
};
