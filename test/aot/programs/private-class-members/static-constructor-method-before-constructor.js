// A static method named `constructor` written before the real constructor.
function t() {
  class C {
    static constructor() {}
    constructor() {}
  }
  console.log("own: " + C.hasOwnProperty("constructor"));
  console.log("differ: " + (C.prototype.constructor !== C.constructor));
}
t();
class D {
  static constructor() {}
  constructor() {}
}
console.log("own: " + D.hasOwnProperty("constructor"));
console.log("differ: " + (D.prototype.constructor !== D.constructor));
