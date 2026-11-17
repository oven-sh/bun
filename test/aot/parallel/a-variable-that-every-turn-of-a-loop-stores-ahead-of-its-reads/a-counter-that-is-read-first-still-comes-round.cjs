var count = 0;
function run(turns) {
  let turn = 0;
  do {
    count = (count + (turn & 3)) | 0;
    turn++;
  } while (turn < turns);
  return count;
}
function peek() {
  return count;
}
console.log("SAID end " + run(Number("7")) + " " + peek());
