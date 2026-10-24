// `#b in C` in a static block above the field is false.
class C {
  static { console.log(#b in C); }
  static #b = 1;
}
