// Class expression name is its own scope: compiled answers as plain.
const A = class Inner {
  static who() {
    return Inner.name;
  }
  me() {
    return Inner === A;
  }
};
console.log(A.who(), new A().me(), typeof Inner);
