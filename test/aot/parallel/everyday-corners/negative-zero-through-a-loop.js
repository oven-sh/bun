// Negative zero through a loop: compiled answers as plain.
function z(list) {
  let p = 1;
  for (const v of list) p *= v;
  return Object.is(p, -0) ? "-0" : String(p);
}
for (const l of [
  [0, -1],
  [-1, 0],
  [0, -1, -1],
  [-0, 1],
  [1, 2],
])
  console.log(z(l));
