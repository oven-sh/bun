// Flags: --aot-testing=CheckWalkAtRunTime
// The place of a call by name remembers where the method lay for two kinds of receivers. Under the word that checks the walk each such answer is asked again of receiver and name, without running code of the program.
// The receivers come out of code that nobody sees: a method of the class, one of the class above, an own field, a property laid later, and a method that is replaced between two rounds: the place must not go on answering the old one.
// The count holds that the check is reached: three rounds of twenty turns, and in each turn at least one place answers out of its memory. How many of the calls come to a place at all is the compiler's business: 112 and 82 have been counted.
// COUNTER: FastPathResultsVerified >= 60
const unseen = (0, eval)("(x) => x");
class Above { tell() { return 1; } }
class Below extends Above { say() { return 2; } }
class Other { tell() { return 3; } say() { return 4; } }
const withField = { tell: () => 5, say: () => 6 };
const laidLater = new Below(); laidLater.tell = () => 7;
function round(all) { let sum = 0; for (let turn = 0; turn < 20; turn++) { for (const one of all) sum += one.tell() * 10 + one.say(); } return sum; }
const all = unseen([new Below(), new Other(), withField, laidLater, new Below()]);
console.log(round(all));
unseen(Above).prototype.tell = () => 8;
console.log(round(all));
delete laidLater.tell;
console.log(round(all));
