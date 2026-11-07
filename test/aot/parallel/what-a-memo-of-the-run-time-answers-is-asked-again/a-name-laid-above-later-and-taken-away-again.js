// Flags: --aot-testing=CheckWalkAtRunTime
// The table of slots remembers, for a Structure and a name, where a read found its answer, or that it found none. A place that reads the name is filled out of that table. Under the word that checks the walk what the table says is asked again of the receiver before a place takes it.
// The name is laid on the object above, and taken away again, between three places that read it. Where the table does not drop what hangs on a chain, the second place stops by name.
// COUNTER: AnswersAskedAgain >= 3
const above = JSON.parse('{"a":1}');
const made = [];
for (let i = 0; i < 4; i++) made.push(Object.setPrototypeOf(JSON.parse('{"b":2}'), above));
function first(x) { return x.late; }
function second(x) { return x.late; }
function third(x) { return x.late; }
let sum = 0;
for (let i = 0; i < 400; i++) sum += first(made[i & 3]) === undefined ? 1 : 0;
above.late = 7;
for (let i = 0; i < 400; i++) sum += second(made[i & 3]) === 7 ? 1 : 0;
delete above.late;
for (let i = 0; i < 400; i++) sum += third(made[i & 3]) === undefined ? 1 : 0;
console.log(sum);
