function take(at: number): string {
  let a = at + 0.5,
    b = at + 1;
  [a, b] = [b, a];
  return a + ":" + b;
}
console.log(take(1), take(2));
