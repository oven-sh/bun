// bind with arguments, call and apply with other receivers, bound twice
function sum(a, b, c) {
  return this.base + a + b + c;
}
function calls(base, n) {
  const one = sum.bind({ base }, n);
  const two = one.bind({ base: 1000 }, n + 1);
  return [sum.call({ base }, 1, 2, 3), sum.apply({ base: -base }, [n, n, n]), one(1, 1), two(1), one.length, two.name, Math.max.apply(null, [base, n])].join();
}
console.log(calls(1, 2));
console.log(calls(100, 0));
console.log(calls(-5, 7));
