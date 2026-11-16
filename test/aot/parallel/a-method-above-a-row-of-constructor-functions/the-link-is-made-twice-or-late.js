// The statement that links runs twice, runs behind the first objects and calls, or stands under a condition that fails.
const unseen = x => [x][JSON.parse("0")];
function Top(x) { this.x = x; }
Top.prototype.sum = function () { return this.x + 1; };
function Mid(x) { this.x = x; }
function Low(x) { this.x = x; }
function Never(x) { this.x = x; }
Low.prototype.twice = Never.prototype.twice = function () { return this.sum() + this.sum(); };
function run(C, count) { let total = 0; for (let i = 0; i < count; i++) total += new C(i & 3).twice(); return total; }
const attempt = work => { try { return work(); } catch (error) { return error.constructor.name; } };
const early = new Low(5);
console.log(attempt(() => run(Low, unseen(2))), attempt(() => early.twice()));
for (let turn = 0; turn < unseen(2); turn++) {
  Object.setPrototypeOf(Low.prototype, Mid.prototype);
  console.log(attempt(() => run(Low, unseen(2))), attempt(() => early.twice()));
  Object.setPrototypeOf(Mid.prototype, Top.prototype);
  console.log(attempt(() => run(Low, unseen(8))), attempt(() => early.twice()));
}
if (unseen(false)) Object.setPrototypeOf(Never.prototype, Top.prototype);
console.log(attempt(() => run(Never, unseen(2))), new Never(1) instanceof Top);
