function k(x) {
  let e = -1,
    f = 1;
  for (let i0 = 1; i0 < 3; i0++) {
    for (let i1 = 1; i1 <= x; i1++) {
      e += (f + 0) & i0;
      f = i1 === f ? i0 : e;
    }
  }
  return f;
}
console.log(k(7));
