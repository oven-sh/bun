let seen = 0;
class Root {
  static toJSON() {
    seen = 1;
    return 2;
  }
}
class Base extends Root {}
class G extends Base {}
class B {}
B.prototype.f = G;
console.log("" + JSON.stringify([new B()], ["f"]) + seen);
