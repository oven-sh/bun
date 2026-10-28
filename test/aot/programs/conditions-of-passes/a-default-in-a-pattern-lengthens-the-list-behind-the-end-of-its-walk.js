// A pattern takes three elements of a list. The default of the second lengthens the list. Where the walk had already come to the end, it stays at the end: the third name gets its default.
function grow(list) {
  list.push(8, 9);
  return 7;
}
function take(list) {
  const [a = 0, b = grow(list), c = 5] = list;
  return a + " " + b + " " + c;
}
const said = [];
for (let round = 0; round < 30; round++) said.push(take([1, 2, 3]));
console.log(said[29], "|", take([1]), "|", take([]), "|", take([1, undefined, 3]), "|", take([1, undefined]));
