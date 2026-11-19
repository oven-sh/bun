// A walk over names hands out whatever names the walked object has; laid on a list they find its methods.
const steps = { flatMap: n => [n, n * 10], findLast: n => n > 5 };
function run(list) {
  let value = list;
  for (const step in steps) value = value[step](steps[step]);
  return value;
}
console.log(run([1, 2]));
