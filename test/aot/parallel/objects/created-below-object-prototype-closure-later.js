// One place hands Object.create() Object.prototype first and an empty literal second. The program stores a function that reads a variable of its maker into the literal, after the first
// object is made. The first object never has it: a call of it there throws before the store and after it.
const members = {};
function make(proto) {
  const made = Object.create(proto); // not a tail call
  made.items = 7;
  return made;
}
function call(made) { try { return made.later(); } catch (e) { return e.constructor.name; } }
function main(label) {
  const first = make(Object.prototype);
  console.log("first: ", call(first));
  const secret = { text: label + process.argv.length };
  members.later = function () { return "later " + secret.text.length + " " + this.items; };
  console.log("first: ", call(first));
  const second = make(members);
  console.log("first: ", call(first));
  console.log("second:", call(second));
}
main("secret");
