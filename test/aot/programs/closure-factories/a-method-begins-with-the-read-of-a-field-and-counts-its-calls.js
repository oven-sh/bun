// The closure captures the field that was read first, a count that the method keeps, and the parameters.
function Helper() {
  this.calls = 0;
  this.tag = "h";
}
Helper.prototype.define = function (target, key, depth) {
  const tag = this.tag;
  const mine = ++this.calls;
  target[key] = function (more) {
    return String(key) + ":" + mine + ":" + depth + ":" + tag + ":" + more;
  };
  return target;
};
const helper = new Helper();
const target = { present: "was here" };
helper.define(target, "alpha", 2);
helper.define(target, "beta", 2);
console.log(target.alpha("m"), target.beta("m"), helper.calls);
