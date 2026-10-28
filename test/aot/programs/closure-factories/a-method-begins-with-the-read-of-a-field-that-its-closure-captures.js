// The first thing the method does is read a field that the constructor function fills with a written string.
function Helper() {
  this.tag = "h";
}
Helper.prototype.define = function (target, key) {
  const tag = this.tag;
  target[key] = function () {
    return tag;
  };
};
Helper.prototype.alias = function (target, key) {
  this.define(target, key);
};
const target = {};
new Helper().define(target, "alpha");
new Helper().alias(target, "beta");
const changed = new Helper();
changed.tag = "other";
changed.define(target, "gamma");
console.log(target.alpha(), target.beta(), target.gamma());
