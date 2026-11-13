// Two lists: the inner loop pushes onto both, the outer one onto the second
function halves(n) {
  const even = [];
  const odd = [];
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 3; k++) {
      even.push(i * n + k);
      if (k === 1) odd.push(i - k);
    }
    odd.push(even.length);
  }
  return even.join() + " ; " + odd.join();
}
console.log(halves(2));
console.log(halves(0.25));
console.log(halves(2147483647).length, halves(-3));
