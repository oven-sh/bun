// Twenty elements of a list of numbers are read one after the other, and a count goes up in front of each read: by twenty a call, also where the list ends early or lacks an element.
function sum(state, list) {
  let total = 0;
  state.count++;
  total += list[0];
  state.count++;
  total += list[1];
  state.count++;
  total += list[2];
  state.count++;
  total += list[3];
  state.count++;
  total += list[4];
  state.count++;
  total += list[5];
  state.count++;
  total += list[6];
  state.count++;
  total += list[7];
  state.count++;
  total += list[8];
  state.count++;
  total += list[9];
  state.count++;
  total += list[10];
  state.count++;
  total += list[11];
  state.count++;
  total += list[12];
  state.count++;
  total += list[13];
  state.count++;
  total += list[14];
  state.count++;
  total += list[15];
  state.count++;
  total += list[16];
  state.count++;
  total += list[17];
  state.count++;
  total += list[18];
  state.count++;
  total += list[19];
  return total;
}
const state = { count: 0 };
const plain = length => Array.from({ length }, (_, at) => at + 0.5);
let all = 0;
for (let round = 0; round < 60; round++) all += sum(state, plain(20));
const said = [];
for (let length = 0; length < 20; length++) said.push(String(sum(state, plain(length))));
for (let at = 0; at < 20; at++) {
  const list = plain(20);
  delete list[at];
  said.push(String(sum(state, list)));
}
console.log(all, state.count, new Set(said).size);
