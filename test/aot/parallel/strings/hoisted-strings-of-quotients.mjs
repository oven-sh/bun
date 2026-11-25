// BUILD: --aot-harden=proof-checks
// rows[k][j] + f, f a quotient: where `rows` is a string, the loop joins a character and the string that was made of f before it.
function sum(rows, m) {
  const n = rows.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let k = i + 1; k < n; k++) {
      const f = rows[k][i] / rows[i][i];
      let j = i;
      while (j < m) {
        total += (rows[k][j] + f) | 0;
        j++;
      }
    }
  }
  return total;
}
const strings = ["123", 3];
console.log(sum(...strings));
console.log(sum([[4, 2], [3, 5]], 2), sum([["4", "2"], ["3", "5"]], 2), sum("12", 3));
function join(rows, m) {
  let text = "";
  for (let i = 0; i < rows.length; i++) {
    const f = rows[i][0] / rows[0][0];
    for (let j = 0; j < m; j++) text += rows[i][j] + f + ";";
  }
  return text;
}
const others = ["248", 2];
console.log(join(...others), join([[1, 2], [3, 4]], 2), join(["ab", "cd"], 1));
