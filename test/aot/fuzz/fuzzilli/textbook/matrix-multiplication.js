function multiplied(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    out[i] = [];
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < b.length; k++) {
        sum += a[i][k] * b[k][j];
      }
      out[i][j] = sum;
    }
  }
  return out;
}
console.log(JSON.stringify(multiplied(JSON.parse("[[1,2],[3,4]]"), JSON.parse("[[5,6],[7,8]]"))));
