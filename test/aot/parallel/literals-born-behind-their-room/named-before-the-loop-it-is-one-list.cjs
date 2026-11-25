// A literal that something has named before the loop that fills it is ONE list: whoever took the name sees what the loop pushes. Each function hands the name on in another way in front of the loop.
"use strict";
const seed = JSON.parse('["a", 2]');
function inAnObject(n) { const list = [seed[0]]; const holder = { list }; for (let i = 0; i < n; i++) list.push(i); return [holder.list.length, holder.list === list]; }
function inAList(n) { const list = [seed[0]]; const holder = [list]; for (let i = 0; i < n; i++) list.push(i); return [holder[0].length, holder[0] === list]; }
function inAClosure(n) { const list = [seed[0]]; const read = () => list.length; for (let i = 0; i < n; i++) list.push(i); return [read(), n]; }
function underAnotherName(n) { const list = [seed[0]]; let other = list; for (let i = 0; i < n; i++) { list.push(i); if (i === 2) other = [seed[1]]; } return [other.length, other === list]; }
function broughtRound(n) { let list = [seed[0]]; const first = list; for (let i = 0; i < n; i++) { list.push(i); if (i === 2) list = [seed[1]]; } return [first.length, list.length, first === list]; }
function readInFront(n) { const list = [seed[0]]; const before = list.length; for (let i = 0; i < n; i++) list.push(i); return [before, list.length]; }
function storedInFront(n) { const list = [seed[0]]; list[0] = seed[1]; for (let i = 0; i < n; i++) list.push(i); return [list[0], list.length]; }
function behindABranch(n, flag) { const list = [seed[0]]; let kept = null; if (flag) kept = list; for (let i = 0; i < n; i++) list.push(i); return [kept ? kept.length : -1, list.length]; }
function twoInFrontOfOneLoop(n) { const one = [seed[0]]; const two = [one]; for (let i = 0; i < n; i++) { one.push(i); two.push(i); } return [two[0].length, two[0] === one, two.length]; }
function inEveryTurnOfAnOuterLoop(n) { let last = null; let sum = 0; for (let j = 0; j < 4; j++) { const list = [j]; for (let i = 0; i < n; i++) list.push(last ? last.length : i); sum += list.length; last = list; } return [sum, last.length, last[0]]; }
for (let n = 0; n <= 12; n += n < 5 ? 1 : 7) {
  console.log(n, JSON.stringify([inAnObject(n), inAList(n), inAClosure(n), underAnotherName(n), broughtRound(n), readInFront(n), storedInFront(n), behindABranch(n, true), behindABranch(n, false), twoInFrontOfOneLoop(n), inEveryTurnOfAnOuterLoop(n)]));
}
