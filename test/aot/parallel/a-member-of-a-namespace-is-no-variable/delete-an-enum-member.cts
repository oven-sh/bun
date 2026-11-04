function one() { return 1; }
enum E {
  A = one(),
  // @ts-ignore
  B = (delete A) ? 5 : 6,
}
console.log(E.A, E.B, "A" in E);
