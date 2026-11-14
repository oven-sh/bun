const veil = value => JSON.parse("0", () => value);
const said = [];
// The neighbours of the form: the answer of push is read; two pushes a turn; a push under a condition; a turn that goes on or leaves in front of the push; two values written and the counter from 1; one value and the counter from 0 or 2; a step of 2; a counter that runs down; the literal written outside the loop around; a hole in the literal; a spread in it; two values handed to push; none.
const row = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11]");
const forms = {
  answerRead(n) { const next = [1]; let s = 0; for (let j = 1; j <= n; j++) s += next.push(Math.min(row[j] + 1, next[j - 1] + 1)); return next.join() + "/" + s; },
  twice(n) { const next = [1]; for (let j = 1; j <= n; j++) { next.push(Math.min(row[j] + 1, next[j - 1] + 1)); next.push(next[j - 1] + 5); } return next.join(); },
  conditional(n) { const next = [1]; for (let j = 1; j <= n; j++) if (j & 1) next.push(Math.min(row[j] + 1, (next[j - 1] ?? 30) + 1)); return next.join(); },
  goesOn(n) { const next = [1]; for (let j = 1; j <= n; j++) { if (j === 2) continue; next.push(Math.min(row[j] + 1, (next[j - 1] ?? 30) + 1)); } return next.join(); },
  leaves(n) { const next = [1]; for (let j = 1; j <= n; j++) { if (j === 4) break; next.push(Math.min(row[j] + 1, next[j - 1] + 1)); } return next.join(); },
  twoWritten(n) { const next = [1, 2]; for (let j = 1; j <= n; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1)); return next.join(); },
  fromZero(n) { const next = [1]; for (let j = 0; j < n; j++) next.push(Math.min(row[j] + 1, next[j] + 1)); return next.join(); },
  fromTwo(n) { const next = [1]; for (let j = 2; j <= n; j++) next.push(Math.min(row[j] + 1, (next[j - 1] ?? 30) + 1)); return next.join(); },
  byTwo(n) { const next = [1]; for (let j = 1; j <= n; j += 2) next.push(Math.min(row[j] + 1, (next[j - 1] ?? 30) + 1)); return next.join(); },
  down(n) { const next = [1]; for (let j = n; j >= 1; j--) next.push(Math.min(row[j] + 1, (next[j - 1] ?? 30) + 1)); return next.join(); },
  hole(n) { const next = [, ]; for (let j = 1; j <= n; j++) next.push(Math.min(row[j] + 1, (next[j - 1] ?? 30) + 1)); return next.join(); },
  spread(n) { const next = [...row.slice(0, 1)]; for (let j = 1; j <= n; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1)); return next.join(); },
  twoHanded(n) { const next = [1]; for (let j = 1; j <= n; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1), 0); return next.join(); },
  noneHanded(n) { const next = [1]; for (let j = 1; j <= n; j++) next.push(); return next.join(); },
};
function outside(n) { const next = [1]; const out = []; for (let i = 0; i < 3; i++) { for (let j = 1; j <= n; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1)); out.push(next.length); } return out.join() + "/" + next.join(); }
for (let turn = 0; turn < 3; turn++) { for (let i = 0; i < 2; i++) for (const name of Object.keys(forms)) said.push(name + ":" + forms[JSON.parse(JSON.stringify(name))](5 + i)); said.push(outside(3)); }
console.log(said.join(" | "));
