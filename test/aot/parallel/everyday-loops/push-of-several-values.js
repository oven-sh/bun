// push of two and of no values, spread pushes, in two loops
function spread(values) {
  const out = [];
  let sizes = 0;
  for (let i = 0; i < 3; i++) {
    sizes += out.push(i, values[i]);
    for (let k = 0; k < 2; k++) {
      out.push();
      out.push(...values.slice(k, i));
    }
    sizes += out.push(...[]);
  }
  return out.join() + " " + sizes;
}
console.log(spread([1, 2, 3]));
console.log(spread(["a", "b"]));
console.log(spread([]), spread([0.5, null, -0]));
