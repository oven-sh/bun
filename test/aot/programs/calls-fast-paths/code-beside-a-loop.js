// What a function does outside its loops is compiled as in a function that has no loop. Here the length of what is expected to be
// an array is compared with a number: both functions test for an int32 in line and call the same stub behind that test.
// CALLS+ comparesLength LessAfterInt32Check
// CALLS+ comparesLengthBesideLoop LessAfterInt32Check
function comparesLength(list) {
  return list.length < 3;
}
function comparesLengthBesideLoop(list) {
  let sum = 0;
  for (let i = 0; i < 2; i++) sum += i;
  return list.length < 3 ? sum : -sum;
}
const functions = [comparesLength, comparesLengthBesideLoop];
console.log(comparesLength([1, 2]), comparesLengthBesideLoop([1, 2]), comparesLengthBesideLoop([1, 2, 3, 4]), functions.length);
