// A helper called in a loop holds its product in an arm: one side of a choice, behind an early return, in an `if`. What it reckons with are constants of the file out of a text. The arm is never entered,
// entered in the last turn alone, in every second turn, or in every turn; the odd constant is a text, null, a boolean, an object that counts its valueOf, a big integer; each has a twin that is a number.
const parts = JSON.parse(process.env.NOTHING_SET_HERE || '[0.5,1.25,"3",null,true,false]'), list = JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]");
const low = parts[0], high = parts[1], text = parts[2], nothing = parts[3], yes = parts[4], never = parts[5];
let asked = 0;
const counting = parts.length ? { valueOf() { asked++; return 2; } } : 0, big = parts.length ? 2n : 0;
function choice(take, a, b) { return take ? a * b : 0; }
function early(take, a, b) { if (!take) return 0; return a * b; }
function inside(take, a, b) { let made = 0; if (take) made = a * b - b / 2; return made; }
function neverText() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(never, low, text); return sum; }
function neverNumber() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(never, low, high); return sum; }
function neverTextEarly() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + early(never, low, text); return sum; }
function neverTextInside() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + inside(never, low, text); return sum; }
function neverBig() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(never, low, big); return sum; }
function lastText() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(i === 7, low, text); return sum; }
function lastNumber() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(i === 7, low, high); return sum; }
function lastBig() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + early(i === 7, low, big); return sum; }
function lastCounting() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + inside(i === 7, low, counting); return sum; }
function secondNull() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + inside(i & 1, nothing, high); return sum; }
function secondCounting() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(i & 1, counting, high); return sum; }
function everyYes() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + early(yes, yes, high); return sum; }
function everyText() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(yes, low, text); return sum; }
function everyNumber() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + inside(yes, low, high); return sum; }
function everyCounting() { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum + list[i] + choice(yes, counting, counting); return sum; }
for (const run of [neverText, neverNumber, neverTextEarly, neverTextInside, neverBig, lastText, lastNumber, lastBig, lastCounting, secondNull, secondCounting, everyYes, everyText, everyNumber, everyCounting]) {
  for (let again = 0; again < 2; again++) { try { console.log(run.name, run(), asked); } catch (error) { console.log(run.name, error.constructor.name, asked); } }
}
