// Control: an `if` in place of the `switch` always built.
function count(list, from, to) {
  let zeros = 0, i = from;
  while (i < to) {
    if (list[i] === 0) zeros++;
    i += 1;
  }
  return zeros + "/" + i;
}
console.log(count(JSON.parse("[4,0,6]"), process.argv.length, 5));
