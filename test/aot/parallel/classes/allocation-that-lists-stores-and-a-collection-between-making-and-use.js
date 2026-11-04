// what the allocation of a constructor function lists was made a moment ago and is held by nothing else: the heap is collected between the making and the use, and in the body behind the head
function Pair(left, right, turn) { this.left = left; this.right = right; this.turn = turn; this.text = "t"; Bun.gc(true); this.late = [turn]; }
function Quick(left, right) { this.left = left; this.right = right; this.count = 0; }
function make(turn) { return new Pair({ value: turn }, [turn, turn + 1], turn); }
function makeQuick(turn) { return new Quick({ value: turn }, "text " + turn); }
function deed() { Bun.gc(true); }
function show(pair) { return JSON.stringify(pair); }
const kept = [];
for (let turn = 0; turn < 40; turn++) { kept.push(make(turn)); kept.push(makeQuick(turn)); if (turn % 8 === 0) deed(); }
deed();
let text = "";
for (let index = 0; index < kept.length; index += 13) text += show(kept[index]) + "\n";
console.log(text);
const many = [];
for (let turn = 0; turn < 20000; turn++) many.push(makeQuick(turn));
deed();
let sum = 0;
for (let index = 0; index < many.length; index++) sum += many[index].left.value + many[index].right.length + many[index].count;
console.log(sum);
