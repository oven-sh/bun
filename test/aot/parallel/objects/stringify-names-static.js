let seen = 0;
class G {
  static toJSON() {
    seen = 1;
    return 2;
  }
}
class B {}
B.prototype.f = G;
console.log("" + JSON.stringify([new B()], ["f"]) + seen);
