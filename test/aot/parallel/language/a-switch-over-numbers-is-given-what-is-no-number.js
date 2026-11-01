function pick(value) {
  switch (value) {
    case 0:
      return "zero";
    case 3:
      return "three";
    case 5:
      return "five";
    case -7:
      return "minus seven";
    case 4294967296:
      return "two to the 32nd";
    default:
      return "none";
  }
}
function ofMember(options) {
  switch (options.width) {
    case 3:
      return 10;
    case 5:
      return 20;
    default:
      return 30;
  }
}
const three = { valueOf: () => 3, toString: () => "3" };
const subjects = [
  0, -0, 3, 3.0, 5, -7, 4294967296, 3.5, NaN, Infinity, -Infinity, 2 ** 53, 1e300,
  undefined, null, true, false, "", "3", "three", 3n, 0n, Symbol.for("3"), three, [3], [], {}, () => 3,
];
for (const parsed of JSON.parse('[3, 3.0, 5e0, 0.5e1, -7, "5", null, [5], {"width": 5}, 4294967296]')) subjects.push(parsed);
for (const each of [pick]) console.log(subjects.map(subject => each(subject)).join());
const holders = [
  { width: 3, label: "a" },
  { label: "b" },
  { width: 5, label: "c" },
  { width: undefined, label: "d" },
  { width: null, label: "e" },
  { width: "3", label: "f" },
  { width: 5.0, label: "g" },
  { width: 5.5, label: "h" },
  { width: three, label: "i" },
];
for (const each of [ofMember]) console.log(holders.map(holder => each(holder)).join());
let sum = 0;
for (let turn = 0; turn < 1000; turn++) sum += ofMember(holders[turn % holders.length]);
console.log(sum);
