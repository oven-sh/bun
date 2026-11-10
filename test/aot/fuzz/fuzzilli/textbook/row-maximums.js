function greatestOfRows(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    let top = rows[i][0];
    for (let j = 1; j < rows[i].length; j++) {
      if (rows[i][j] > top) top = rows[i][j];
    }
    out[i] = top;
  }
  return out;
}
console.log(greatestOfRows(JSON.parse("[[1,9,3],[7,2,5],[4,4,8]]")).join());
