const parts = JSON.parse('[0.5,1.25,"3",[1.5,2.5],{"0":1.5,"1":2.5}]'), list = JSON.parse('[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]'), no = JSON.parse('false'), rounds = JSON.parse('7');
function pick(take, a, b) { return take ? a * b : 0; }
function total(turn) { let sum = turn & 1; for (let i = 0; i < list.length; i++) sum = sum + list[i] + pick(i === 7, parts[0], parts[2]); return sum; }
let all = 0; for (let turn = 0; turn < rounds; turn++) all += total(turn); console.log(all);
