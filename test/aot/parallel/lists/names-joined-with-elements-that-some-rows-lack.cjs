// Flags: --aot-harden=proof-checks
// Under the checks of proofs the build stopped: the second element of a row is joined with the first, a text in some rows, and the last rows lack it.
function join(rows) {
  let s = "",
    n = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i],
      name = row[0],
      value = row[1];
    if (name === "b") n += 2;
    s = name + value;
  }
  return [s, n].join();
}
for (let turn = 0; turn < 24; turn++) console.log(turn, join(JSON.parse('[["a", 1], ["b"], [1.5]]')));
