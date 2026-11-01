// A counted loop that changes nothing and whose results nobody uses is removed also where its test computes the bound again in every turn: `k < (n | 0)`, `i < list.length`.
// One that makes its list longer, or whose bound may be Infinity, stays.
// IR= 0 boundMadeAnInteger LoopHint
// IR= 0 boundIsALength LoopHint
// IR= 1 listGrows LoopHint
// IR= 1 boundMayBeInfinite LoopHint
export function boundMadeAnInteger(i, n) {
  let sum = 0;
  for (let k = 0; k < (n | 0); k++) sum += k * i;
  return i + 1;
}
export function boundIsALength(i, list) {
  let sum = 0;
  for (let k = 0; k < list.length; k++) sum += k * i;
  return i + 2;
}
export function listGrows(i, list) {
  for (let k = 0; k < list.length && k < 6; k++) list.push(k * i);
  return list.length;
}
export function boundMayBeInfinite(i, n) {
  let sum = 0;
  for (let k = 0; k < n * 2; k++) sum += k;
  return i + 3;
}
// What the build cannot know: a number that is read from a text.
const read = text => Number(text);
const list = [];
for (let k = read("0"); k < read("4"); k++) list.push(k);
console.log(boundMadeAnInteger(1, read("5")), boundMadeAnInteger(2, read("-5.5")), boundMadeAnInteger(3, read("x")), boundIsALength(4, list), boundIsALength(5, []), listGrows(6, list), list.join(), boundMayBeInfinite(7, read("3.5")));
