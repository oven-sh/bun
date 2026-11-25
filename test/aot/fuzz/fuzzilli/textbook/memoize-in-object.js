const remembered = {};
function square(n) {
  if (!(n in remembered)) remembered[n] = n * n;
  return remembered[n];
}
console.log(square(4), square(4), square(5), Object.keys(remembered).join());
