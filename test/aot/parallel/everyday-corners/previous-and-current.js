// Previous and current: compiled answers as plain.
function runs(list) {
  let prev,
    n = 0;
  for (const cur of list) {
    if (cur !== prev) n++;
    prev = cur;
  }
  return n;
}
for (const l of [[1, 1, 2], [undefined, 1], [], [null, undefined], [NaN, NaN], ["1", 1]]) console.log(runs(l));
