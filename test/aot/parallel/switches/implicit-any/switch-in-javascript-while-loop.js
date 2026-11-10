// Control: the same source as JavaScript always built.
function count(list, from, to) {
  let zeros = 0, i = from;
  while (i < to) {
    switch (list[i]) { case 0: zeros++; }
    i += 1;
  }
  return zeros + "/" + i;
}
console.log(count(JSON.parse("[4,0,6]"), process.argv.length, 5));
