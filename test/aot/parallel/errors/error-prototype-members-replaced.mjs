const made = new RangeError("far");
console.log(String(made), made.name);
Error.prototype.toString = function () {
  return "<" + this.name + ">";
};
RangeError.prototype.name = "Range";
Error.prototype.message = "nothing said";
console.log(
  String(made),
  made.toString(),
  `${new Error()}`,
  new Error().message,
  new SyntaxError().message,
  new RangeError("x").name,
);
