// What a loop pops, adds to and pushes again: int32s at their borders, doubles, undefined, strings.
// STATISTIC: PushedSumsStayBoxed >= 3
const show = list => list.map(x => Object.is(x, -0) ? "-0" : String(x)).join();
const stack = [1, 2, 3];
function ofModule(turns) { let n = 0; for (let k = 0; k < turns; k++) n += (stack.push(stack.pop() + 1), stack[2] & 1); return n; }
function down(list, turns) { for (let k = 0; k < turns; k++) list.push(list.pop() - 1); return show(list); }
function stepped(list, steps) { let n = 0; for (let k = 0; k < steps.length; k++) { list.push(list.pop() + (steps[k] | 0)); n += list.length; } return show(list) + " " + n; }
function emptied(list, turns) { for (let k = 0; k < turns; k++) { if (k === 3) list.length = 0; list.push(list.pop() + 2); } return show(list); }
console.log(ofModule(10), ofModule(1), show(stack));
for (const last of [0, 5, 2147483646, 2147483647, -2147483648, 0.5, -0, NaN, 2 ** 53, undefined]) {
  console.log(down([1, last], 3), stepped([1, last], [1, -1, 2147483647, 2147483647, -2147483648]), emptied([4, last], 2), emptied([4, last], 6));
}
for (const list of [[], ["x"], [null], [true], [1.5, 2.5], [1, "2"]]) console.log(down(list.slice(), 2), stepped(list.slice(), [1, 2]), emptied(list.slice(), 5));
