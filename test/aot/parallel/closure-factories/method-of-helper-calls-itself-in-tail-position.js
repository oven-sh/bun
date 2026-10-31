// A method that defines a member under a written name calls itself through `this` with the name passed along.
function Helper(target, prefix) {
  this.target = target;
  this.prefix = prefix;
  this.calls = 0;
}
Helper.prototype.define = function (name, value) {
  this.calls++;
  if (typeof value !== "function") return this.define(name, () => value);
  this.target[name] = value;
  return this;
};
Helper.prototype.repeat = function (name, times) {
  this.target[name] = function () {
    return name + times;
  };
  if (times) this.repeat(name, times - 1);
  return this;
};
Helper.prototype.constant = function (name) {
  var prefix = this.prefix;
  this.target[name] = function () {
    return 7;
  };
  this.last = prefix + name;
  return this;
};

var object = {};
var helper = new Helper(object, "p:");
helper.define("x", 1);
helper.define("y", () => 2);
helper.repeat("r", 6);
helper.constant("a").constant("b");
console.log(object.x(), object.y(), object.r(), helper.calls, helper.last);
console.log(Object.keys(object).join());
console.log(object.a(), object.b(), object.a !== object.b, object.r.name, object.x.name);
