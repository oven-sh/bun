function outer() {
  const f = (x: number) => x + 1;
  const list = [f, f];
  const same = list[0] === f && list[1] === list[0];
  return f(1) + ":" + list[0](2) + ":" + same + ":" + f.name + ":" + f.length + ":" + typeof f;
}
console.log(outer());
