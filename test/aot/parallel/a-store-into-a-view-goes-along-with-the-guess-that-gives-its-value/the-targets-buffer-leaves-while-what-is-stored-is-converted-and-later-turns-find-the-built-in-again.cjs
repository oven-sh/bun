// In a loop the result of a built-in method's call is stored into a typed array, and the store goes along with the guess that the DataView is as made. Here a function of the same name
// lies on the DataView itself: in the third turn it deletes itself and gives an object whose valueOf, asked by the store, transfers the buffer of the target away. The later turns find the
// built-in again and store into a view that has no memory any more.
"use strict";
const numbers = new Float64Array(8).map((_, i) => i * 1.5);
const pane = new DataView(numbers.buffer);
const target = new Float64Array(8);
let calls = 0;
let taken;
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
    return {
      valueOf() {
        taken = target.buffer.transfer();
        return 7.5;
      },
    };
  }
  return at + 0.25;
};
console.log(copy(1), target.length, calls);
console.log(new Float64Array(taken).join());
console.log(copy(2), target.length, calls);
