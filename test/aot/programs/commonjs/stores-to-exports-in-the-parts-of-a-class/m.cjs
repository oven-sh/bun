class A extends (exports.a = 1, Object) {
  static s = (exports.b = 2);
  [(exports.c = 3)]() {}
  i = (exports.d = 4);
  static { exports.e = 5; }
}
exports.z = 0;
