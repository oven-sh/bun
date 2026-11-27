// Rest parameters and spread arguments passed through two functions
function inner(first, ...others) {
  return first + ":" + others.length + ":" + others.reduce((a, b) => a + b, 0);
}
function outer(...all) {
  const [head, ...tail] = all;
  return inner(head, ...tail, all.length) + " " + inner(...tail);
}
console.log(outer(1, 2, 3));
console.log(outer(10, 20));
console.log(outer(5, 4, 3, 2, 1));
