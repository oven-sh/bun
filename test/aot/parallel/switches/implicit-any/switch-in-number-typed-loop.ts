// Control: parameters typed as numbers always built.
function count(list: number[], from: number, to: number) {
  let zeros = 0, i = from;
  while (i < to) {
    switch (list[i]) { case 0: zeros++; }
    i += 1;
  }
  return zeros + "/" + i;
}
console.log(count(JSON.parse("[4,0,6]"), process.argv.length, 5));
