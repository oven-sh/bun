const sample: any = { id: 1, name: "n", active: true }; const kept: any[] = [sample];
const data: any = JSON.parse('{"users":[{"id":0,"name":"a","active":true},{"id":1,"name":"b","active":false},{"id":2,"name":"c","active":true}],"orders":[{"user":2,"lines":[15]},{"user":0,"lines":[3]},{"user":2,"lines":[1]},{"user":1,"lines":[20]}]}');
function search(turn: number): number { let total = 0; outer: for (const user of data.users) { if (!user.active) continue; for (const order of data.orders) { if (order.user !== user.id) continue; if (order.lines.some((line: any) => line > 14)) { total += user.id + 1; continue outer; } if (total > 900 + (turn & 7)) break outer; } } return total; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + search(turn)) % 1000003;
console.log(all, kept.length);
