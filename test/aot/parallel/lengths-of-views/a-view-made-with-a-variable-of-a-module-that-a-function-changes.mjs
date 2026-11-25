// Flags: --aot-harden=proof-checks
// The variable is asked for at each read whether it has been initialized: what the view is made with and the limit of the loop are two such checks of one value, and the build stopped.
let n = 5;
function bump() {
  n = (n + 1) % 9;
}
const stored = () => {
  const view = new Uint8Array(n);
  for (let i = 0; i < n; i++) view[i] = i;
  return view;
};
const storedByName = () => {
  const count = n;
  const view = new Uint8Array(count);
  for (let i = 0; i < count; i++) view[i] = i * 3;
  return view;
};
const read = () => {
  const count = n;
  const view = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) sum += view[i] + i;
  return sum;
};
const listed = () => {
  const list = new Array(n).fill(0);
  for (let i = 0; i < n; i++) list[i] += i + 1;
  return list;
};
const changedBetween = () => {
  const view = new Int32Array(n);
  bump();
  for (let i = 0; i < n; i++) view[i] = i + 1;
  return view;
};
function inTurns(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const view = new Uint16Array(n);
    for (let i = 0; i < n; i++) view[i] = i + turn;
    for (let i = 0; i < n; i++) sum = (sum * 3 + view[i]) | 0;
    if (turn % 5 === 4) bump();
  }
  return sum;
}
for (let turn = 0; turn < 12; turn++) {
  console.log(stored().join(), storedByName().join(), read(), listed().join(), changedBetween().join(), inTurns(turn * 7));
  bump();
}
