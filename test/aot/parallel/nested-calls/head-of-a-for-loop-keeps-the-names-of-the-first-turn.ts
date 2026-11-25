function outer() {
  const said: number[] = [];
  const later: Array<() => number> = [];
  for (let i = 0, f = () => i; i < 3; i++) { said.push(f()); later.push(() => f()); }
  return said.join("") + ":" + later.map(g => g()).join("");
}
console.log(outer());
