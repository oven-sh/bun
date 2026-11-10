// Control: a `for` loop with its own counter and `i++` always built.
function count(list, from, to) {
  let zeros = 0;
  for (let i = from; i < to; i++) {
    switch (list[i]) { case 0: zeros++; }
  }
  return zeros + "/" + to;
}
console.log(count(JSON.parse("[4,0,6]"), process.argv.length, 5));
