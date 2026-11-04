let seen = 0;
class B {
  m() {}
}
Object.defineProperty(B.prototype.m, "toJSON", {
  value() {
    seen = 1;
    return 2;
  },
});
console.log("" + JSON.stringify([new B()], ["m"]) + seen);
