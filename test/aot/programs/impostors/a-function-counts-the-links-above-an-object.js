function depth(value) {
  let steps = 0;
  while (value) {
    steps++;
    value = Object.getPrototypeOf(value);
  }
  return steps;
}
console.log(depth({ a: 1 }));
