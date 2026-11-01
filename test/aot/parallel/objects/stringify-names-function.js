let seen = 0;
class B {}
B.prototype.f = Object.assign(function () {}, {
  toJSON() {
    seen = 1;
    return 2;
  },
});
console.log("" + JSON.stringify([new B()], ["f"]) + seen);
