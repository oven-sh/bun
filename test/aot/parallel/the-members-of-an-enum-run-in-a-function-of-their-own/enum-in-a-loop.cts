const seen: string[] = [];
for (let i = 0; i < 3; i++) {
  enum E { A = (seen.push(eval("typeof q")), eval("var q = " + i), 1), B = (() => eval("q"))() }
  seen.push(String(E.B));
}
console.log(seen.join());
