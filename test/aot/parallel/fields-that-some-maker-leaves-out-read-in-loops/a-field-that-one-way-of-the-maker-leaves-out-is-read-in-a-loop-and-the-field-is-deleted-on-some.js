const out = [];
function factory(tag) { function Row(value) { if (value % 3) this.mark = value; this.name = tag; } return Row; }
const First = factory("a"), Second = factory("bb");
function sumInLoop(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const mark = list[i].mark; sum += mark === undefined ? 100000 : +mark; } return sum; }
function countIn(list) { let count = 0; for (const row of list) if (typeof row === "object" && "mark" in row) count++; return count; }
const rows = []; for (let i = 0; i < 240; i++) rows.push(i % 2 ? new First(i) : new Second(i));
out.push(String(sumInLoop(rows)), String(countIn(rows)));
for (let i = 0; i < rows.length; i += 3) delete rows[i].mark;
out.push(String(sumInLoop(rows)), String(countIn(rows)), JSON.stringify(rows.slice(0, 7)), Object.keys(rows[0]).join(), Object.keys(rows[1]).join());
for (let turn = 0; turn < 50; turn++) sumInLoop(rows);
out.push(String(sumInLoop(rows)));
console.log(out.join("\n"));
