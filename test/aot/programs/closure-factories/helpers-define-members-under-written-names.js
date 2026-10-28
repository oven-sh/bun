// Helpers define getters, setters and methods on an object under names that each call writes out.
// IR+ AreMembersUnchanged .*key="height"
// IR+ AreMembersUnchanged .*key="text"
// IR+ AreMembersUnchanged .*key="shout"
function forwardMethod(target, source, name) {
  target[name] = function () {
    return this[source][name].apply(this[source], arguments);
  };
}
function forwardGetter(target, source, name) {
  target.__defineGetter__(name, function () {
    return this[source][name];
  });
}
function forwardSetter(target, source, name) {
  target.__defineSetter__(name, function (value) {
    return (this[source][name] = value);
  });
}
const base = {
  describe() {
    return this.width + "x" + this.height;
  },
};
forwardGetter(base, "box", "width");
forwardSetter(base, "box", "width");
forwardGetter(base, "box", "height");
forwardMethod(base, "box", "area");
forwardGetter(base, "label", "text");
forwardMethod(base, "label", "shout");

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
console.log(sum, last);
