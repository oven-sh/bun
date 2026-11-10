// The list is read in every turn, in the text of the loop itself. The walk asks for its storage while it stands in an arm of its own making (the read's arm for another kind of storage): the place in the text decides whether every turn passes, so the three questions on the list stand in front of the loop and no turn begins again for them.
// STATISTIC: IterationRestartsEmitted <= 8
const data = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => i * 37 % 64).join() + ']');
const up = x => x + 1, down = x => x - 1;
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) { s += (data[i] & 1 ? up : down)(data[i]); } return s; }
const n = +JSON.parse('"3"'); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
