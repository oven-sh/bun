// `new` of a value that no call site can tell apart finds a constructor function with more comment than code. How much text a function takes is no part of the program:
// with other blanks and comments it is the same function.
const hide = (0, eval)("(value) => value");

function Reading(place, value, unit) {
  // Where the reading was taken. Nothing else in the program knows it, so it is kept as it was handed in,
  // also where it is no text at all: whoever prints a reading turns it into one.
  this.place = place;
  // What the instrument showed. A reading that was never taken has no value, which is not the same as zero:
  // the sum below passes such a reading by, and the count does not.
  this.value = value;
  // The unit is written behind the value. Readings in different units are never added to one another,
  // which is why the sums are kept by unit.
  this.unit = unit === undefined ? "mm" : unit;
  // Whether somebody has looked at it yet. Every reading begins unseen, and only the loop below marks one.
  // Nothing ever unmarks it.
  this.seen = false;
  // The order of these four stores is the order in which the keys of a reading are listed, wherever they are
  // asked for, and it is the same for every reading that this function ever makes.
}
function Gap(place) {
  this.place = place;
  this.value = undefined;
}
Reading.prototype.text = function () {
  return String(this.place) + ": " + this.value + " " + this.unit + (this.seen ? " (seen)" : "");
};
Gap.prototype.text = function () {
  return String(this.place) + ": nothing";
};

const makers = hide([Reading, Gap, Reading]);
const sums = {};
let count = 0;
for (let turn = 0; turn < 30; turn++) {
  const Maker = makers[turn % makers.length];
  const made = new Maker(turn % 4 ? "roof " + turn : turn, turn * 1.5, turn % 5 ? undefined : "cm");
  count++;
  if (made.value !== undefined) sums[made.unit] = (sums[made.unit] ?? 0) + made.value;
  if (turn % 7 === 0) made.seen = true;
  if (turn % 6 === 0) console.log(made.text(), Object.keys(made).join(), made instanceof Reading);
}
console.log(count, JSON.stringify(sums));
console.log(Reading.length, Reading.name);
