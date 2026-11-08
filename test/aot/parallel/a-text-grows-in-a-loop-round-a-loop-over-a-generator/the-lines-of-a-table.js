function* cells(row) { yield row; yield row + 1; }
function table(n) {
  let out = '';
  for (let row = 0; row < n; row++) { let line = ''; for (const c of cells(row)) line += c; out += line + '\n'; }
  return out;
}
console.log(table(3));
