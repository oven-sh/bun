// Fields and elements swapped by destructuring assignments
function rotate(a, b, c) {
  const item = { a, b, c, list: [a, b, c] };
  ({ a: item.b, b: item.c, c: item.a } = item);
  [item.list[2], item.list[0], item.list[1]] = item.list;
  let x, rest;
  ({ a: x, ...rest } = item);
  return x + " " + JSON.stringify(rest);
}
console.log(rotate(1, 2, 3));
console.log(rotate(10, 0, -10));
console.log(rotate(7, 7, 8));
