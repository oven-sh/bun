// A `var` holds undefined until its assignment has run, so a call above the assignment throws, and the calls below it work.
let early;
try {
  early = wrap(() => 1);
} catch (error) {
  early = error.constructor.name;
}
var wrap = run => () => run();
const two = wrap(() => 2);
const three = wrap(() => "three");
console.log(early, two(), three());

let tooEarly;
try {
  tooEarly = hold(() => 1);
} catch (error) {
  tooEarly = error.constructor.name;
}
const hold = run => () => run();
const four = hold(() => 4);
const five = hold(() => "five");
console.log(tooEarly, four(), five());

const six = declared(() => 6);
const seven = declared(() => "seven");
function declared(run) {
  return () => run();
}
console.log(six(), seven());
