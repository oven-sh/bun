let seen = 0;
class G {}
G.prototype.n = Object.assign(function () {}, {
  toString() {
    seen = 1;
    return "text";
  },
});
const re = {
  flags: "",
  k: 0,
  exec() {
    if (this.k++) return null;
    const m = ["a"];
    m.index = 0;
    m.groups = new G();
    return m;
  },
};
console.log("" + RegExp.prototype[Symbol.replace].call(re, "a", "[$<n>]") + seen);
