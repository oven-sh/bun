function outer(list) {
  let sum = 0;
  function once(value, action) { return action(value); }
  function add(x) { sum += x; return sum; }
  function each() { for (const x of list) once(x, add); return once(1, add); }
  return each() + ":" + sum;
}
console.log(outer([1, 2, 3]), outer([]));
