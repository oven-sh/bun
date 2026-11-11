// The function hands its rest list on in a loop of its own: every turn takes the same list.
const seen = [];
function look(list) { seen.push(list); list.push(seen.length); return list.length; }
function fire(count, ...args) { let sum = 0; for (let k = 0; k < count; k++) sum += look(args); return sum; }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let sum = 0; for (let i = 0; i < upTo[3]; i++) sum += fire(2, turn, i); return sum; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
console.log(seen[0] === seen[1], seen[1] !== seen[2]);
