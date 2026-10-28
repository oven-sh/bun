// A loop over a list holds, behind a test that seldom holds, a loop over a slice of that list. Each loop counts up to the length of its own list.

function f(x, y, l0) {
  let n0 = x, n1 = y, l1 = l0.slice();
  l0[2] = 5;
  for (let i = 0; i < l0.length; i++) {
    n1 = (n1 + (n0 >> 1)) | 0;
    if (n1 === 0) {
      for (let j = 0; j < l1.length; j++) {
        if (l0[2] === 1) { n0 += 1; }
      }
    }
  }
  return n0 + n1;
}
console.log(f(1, 2, [1, 2, 3]));
