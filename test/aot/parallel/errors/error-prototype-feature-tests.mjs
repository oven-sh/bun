console.log(typeof Error.prototype.toJSON, typeof Error.prototype.toString);
if (!Error.prototype.toJSON)
  Error.prototype.toJSON = function () {
    return { name: this.name, message: this.message };
  };
console.log(typeof Error.prototype.toJSON, JSON.stringify([new Error("e"), new URIError("u")]));
const toString = Error.prototype.toString;
Error.prototype.toString = () => "replaced";
console.log(
  toString.call(new Error("kept")),
  Error.prototype.toString.call(new Error("x")),
  String(new EvalError("y")),
);
