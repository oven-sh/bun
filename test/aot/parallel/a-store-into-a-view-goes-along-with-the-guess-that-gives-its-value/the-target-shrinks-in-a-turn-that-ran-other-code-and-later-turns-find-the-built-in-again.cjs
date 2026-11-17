// In a loop the result of a built-in method's call is stored into a typed array, and the store goes along with the guess that the DataView is as made. Here a function of the same name
// lies on the DataView itself: in the third turn it deletes itself and shrinks the buffer of the target, so the later turns find the built-in again and store past the end of what is left.
// What is stored past the end goes nowhere, and memory that is grown again is zero.
"use strict";
const numbers = new Float64Array(8).map((_, i) => i * 1.5);
const pane = new DataView(numbers.buffer);
const room = new ArrayBuffer(64, { maxByteLength: 64 });
const target = new Float64Array(room);
let calls = 0;
function copy(t) {
  for (let i = 0; i < 8; i++) target[i] = pane.getFloat64(i * 8, true);
  return t & 1;
}
const rounds = +JSON.parse('"3"');
let all = 0;
for (let t = 0; t < rounds; t++) all += copy(t);
console.log(all, target.join(), target.length);
pane.getFloat64 = function (at) {
  calls++;
  if (at === 16) {
    delete pane.getFloat64;
    room.resize(16);
    return 7.5;
  }
  return at + 0.25;
};
console.log(copy(1), target.join(), target.length, calls);
room.resize(64);
console.log(target.join(), target.length);
console.log(copy(2), target.join(), calls);
