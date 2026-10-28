// A helper object defines getters, setters and methods on a target under the names that a chain of calls writes out.
function Forwarder(target, source) {
  if (!(this instanceof Forwarder)) return new Forwarder(target, source);
  this.target = target;
  this.source = source;
  this.names = [];
}
Forwarder.prototype.method = function (name) {
  var target = this.target;
  var source = this.source;
  this.names.push(name);
  target[name] = function () {
    return this[source][name].apply(this[source], arguments);
  };
  return this;
};
Forwarder.prototype.access = function (name) {
  return this.getter(name).setter(name);
};
Forwarder.prototype.getter = function (name) {
  var target = this.target;
  var source = this.source;
  this.names.push(name);
  target.__defineGetter__(name, function () {
    return this[source][name];
  });
  return this;
};
Forwarder.prototype.setter = function (name) {
  var target = this.target;
  var source = this.source;
  this.names.push(name);
  target.__defineSetter__(name, function (value) {
    return (this[source][name] = value);
  });
  return this;
};
const base = {
  describe() {
    return this.width + "x" + this.height;
  },
};
Forwarder(base, "box").access("width").getter("height").method("area");
const second = new Forwarder(base, "label");
second.getter("text");
second.method("shout");
function make(width, height, text) {
  const made = Object.create(base);
  made.box = { width, height, area() { return this.width * this.height; } };
  made.label = { text, shout(mark) { return this.text.toUpperCase() + mark; } };
  return made;
}
let sum = 0;
let last = "";
for (let i = 0; i < 1000; i++) {
  const made = make(i, 2, "t" + (i & 3));
  made.width = made.width + 1;
  sum += made.area() + made.height + made.text.length;
  last = made.shout("!") + made.describe();
}
console.log(sum, last, second.names.join(), Object.keys(base).join());
