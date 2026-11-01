let seen = 0;
class G {
  static get toJSON() {
    return () => {
      seen = 1;
      return 2;
    };
  }
}
class B {}
B.prototype.f = G;
console.log("" + JSON.stringify([new B()], ["f"]) + seen);
