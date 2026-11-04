function outer(a: number, b: number, c: number) {
  let n = 0;
  const far = () => () => () => deep;
  return far()()()(1) + ":" + n + ":" + (far()()() === deep);
  function deep(x: number) { n++; return x + a + b + c + other(); }
  function other() { return n * 10; }
}
console.log(outer(1, 2, 3));
