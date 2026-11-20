function* three() { yield 1; yield 2; yield 3; }
function kernel(n) {
  let res = '', s = 0;
  for (let j = 0; j < n; j++) { for (const x of three()) s += x; res += 'x'; }
  return res + s;
}
console.log(kernel(3));
