// `prototype` is read at each construction, behind the arguments and in front of the body.
function Made() {}
const first = Made.prototype;
const second = { name: "second" };
const third = Object.create(null);
third.name = "third";
function nameOf(made) {
  const above = Object.getPrototypeOf(made);
  return above === first ? "first" : above === Object.prototype ? "Object.prototype" : above.name;
}
function make() {
  return new Made();
}
function Changes() {
  Changes.prototype = second;
}
const ofChanges = Changes.prototype;
const told = [];
for (let round = 0; round < 12; round++) {
  if (round === 3) Made.prototype = second;
  if (round === 6) Made.prototype = third;
  if (round === 8) Made.prototype = 7;
  if (round === 10) Made.prototype = first;
  told.push(nameOf(make()));
}
console.log(told.join(" "));
Made.prototype = first;
console.log(nameOf(new Made((Made.prototype = third))), nameOf(new Made()));
console.log(Object.getPrototypeOf(new Changes()) === ofChanges, Object.getPrototypeOf(new Changes()) === second);
