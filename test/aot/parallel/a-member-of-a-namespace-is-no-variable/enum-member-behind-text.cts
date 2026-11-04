function nine() { return 9; }
enum E {
  A = nine(),
  B = (function (code: string) { eval(code); return A; })("var A = 5"),
}
console.log(E.A, E.B);
