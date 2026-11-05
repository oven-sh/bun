// A literal whose members are, in turn, reads of an object that the function is given and functions. The code that reads a member of the result allows for an object that has no such member yet.
// object-census.test.ts counts how many function objects the run makes, without inlining.
function make(options) {
  return {
    first: options.first,
    openArm: () => "open",
    second: options.second,
    closeArm: () => "close",
    third: options.third,
    lastArm: () => "last",
  };
}
const kept = [];
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const made = make(i % 50 ? { first: i, second: i + 1, third: i + 2 } : { third: 1, first: 2, second: 3, extra: 4 });
  kept[i & 7] = made;
  sum += made.first + made.second + made.third;
}
console.log(sum, kept[3].openArm(), kept[4].closeArm(), kept[5].lastArm === kept[5].lastArm, kept[5].lastArm !== kept[6].lastArm);

