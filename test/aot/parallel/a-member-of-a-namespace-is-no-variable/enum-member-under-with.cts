function nine() { return 9; }
enum E {
  A = nine(),
  // @ts-ignore
  B = (function (o) { with (o) { return A; } })({ A: 5 }),
}
console.log(E.A, E.B);
