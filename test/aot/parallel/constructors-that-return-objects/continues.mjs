function Made(n) {
  if (n > 2) return { x: n * 2 };
  this.x = n === 1 ? undefined : n;
}
function total(list) {
  let sum = 0;
  let passed = 0;
  for (let i = 0; i < list.length; i++) {
    const one = new Made(list[i]);
    if (one.x === undefined) {
      passed++;
      continue;
    }
    sum += one.x;
  }
  return [sum, passed];
}
console.log(total([1, 2, 3, 4, 1, 0]));
