// Two and three variables swapped in a loop that also pushes them
function fibonacci(count, a, b) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(a);
    [a, b] = [b, a + b];
    for (let k = 0; k < 2 && i % 3 === 0; k++) list.push((([a, b] = [b, a]), a));
  }
  return list.join();
}
console.log(fibonacci(8, 0, 1));
console.log(fibonacci(5, 0.5, -0.25));
console.log(fibonacci(4, "x", "y"), fibonacci(50, 1, 2).split(",").pop());
