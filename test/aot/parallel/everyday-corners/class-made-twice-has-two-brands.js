// Class made twice has two brands: compiled answers as plain.
const make = () =>
  class {
    #p = 1;
    static has(o) {
      return #p in o;
    }
  };
const A = make(),
  B = make();
console.log(A.has(new A()), A.has(new B()), B.has(new B()), A === B);
