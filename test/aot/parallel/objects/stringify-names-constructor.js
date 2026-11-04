let seen = 0;
class B {
  static toJSON() {
    seen = 1;
    return 2;
  }
}
console.log("" + JSON.stringify([new B()], ["constructor"]) + seen);
