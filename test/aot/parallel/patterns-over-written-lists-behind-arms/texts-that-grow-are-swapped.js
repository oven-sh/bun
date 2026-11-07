function take(n) {
  let s = "", t = "";
  for (let i = 0; i < n; i++) {
    s += "a" + i;
    t += "b";
    [s, t] = [t, s];
  }
  return s + ":" + t;
}
console.log(take(3), take(4));
