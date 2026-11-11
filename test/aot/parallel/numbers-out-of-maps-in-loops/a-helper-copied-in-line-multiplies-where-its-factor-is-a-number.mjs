// A helper that is copied in line asks its second operand for its kind and multiplies by it where it is a number. The multiplication has a rare way for operands that are no numbers, on which it stays as it is written.
// The loop is built twice all the same, and in its typed copy the sum stays typed. The factor is a text here, so the helper hands the element back.
// STATISTIC: WalkLoopsVersioned >= 1
const parts = JSON.parse('[0.5,"x"]'), list = JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]");
const factor = parts[1];
function scale(v, k) { return typeof k === "number" ? v * k : v; }
function total(turn) { let sum = turn & 1; for (let i = 0; i < list.length; i++) sum = sum + scale(list[i], factor); return sum; }
let all = 0; for (let turn = 0; turn < 300; turn++) all += total(turn); console.log(all);
