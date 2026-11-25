function turned(rows) {
  const out = [];
  for (let i = 0; i < rows[0].length; i++) {
    out[i] = [];
    for (let j = 0; j < rows.length; j++) {
      out[i][j] = rows[j][i];
    }
  }
  return out;
}
console.log(JSON.stringify(turned(JSON.parse("[[1,2,3],[4,5,6]]"))));
