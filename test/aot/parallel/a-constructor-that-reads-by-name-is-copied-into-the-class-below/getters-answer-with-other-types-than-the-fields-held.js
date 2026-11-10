class Mark { constructor(row) { this.left = row.left; this.top = row.top; } sum() { return this.left + this.top; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } }
let turn = 0;
const answers = [1.5, 2, "text", undefined, null, { valueOf() { return 40; } }, 3n, NaN, -0, [7], true];
const row = { get left() { return turn < 5 ? turn + 0.5 : answers[turn % answers.length]; }, get top() { return turn < 7 ? 1 : answers[(turn + 3) % answers.length]; }, reach: 3 };
const said = [];
for (turn = 0; turn < 30; turn++) {
  const made = new Round(row);
  let sum; try { sum = String(made.sum()); } catch (error) { sum = error.constructor.name; }
  said.push(typeof made.left + typeof made.top + sum + Object.is(made.left, -0));
}
console.log(said.join(" "));
