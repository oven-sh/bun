let seen = 0;
function f() {}
f.toJSON = function () {
  seen = 1;
  return 2;
};
class B {}
B.prototype.f = f;
console.log("" + JSON.stringify([new B()], ["f"]) + seen);
