// A loop in a try, and a local that the arm of a rare test stores into, behind a list made with that local as its length: the local reaches an edge of the loop, which has no user.
globalThis.last = undefined;
globalThis.said = "";
globalThis.list = [];
function handOn(list, turn = 0) {}
function fill0(given, turn) {
  try {
    for (let k = 0; k < n; k++) {}
  } catch (error) {}
  try {
  } catch (error) {}
  for (let turn = 0; turn < 6; turn++) {}
}
function fill2(given, turn) {
  let n = NaN;
  try {
    list = new Array(n);
  } catch (error) {}
  try {
    for (let k = 0; k < list.length; k++) {
      list[k] = k;
      if (turn % 7 === 6 && k === 1) n = 2;
    }
  } catch (error) {}
  try {
    said += [String(list.indexOf(undefined)), String(list[n - 1])].join(" ");
  } catch (error) {}
}
{
  for (let turn = 0; turn < 3000; turn++) {
    last = fill2(4 + (turn % 3), turn);
  }
}
function fill3(given, turn) {
  try {
  } catch (error) {}
  for (let turn = 0; turn < 300; turn++) {}
}
console.log(last, said.length, list.length);
