let litter = [];
function make(x) { litter = [{ x }, { x }]; return { x }; }
async function tally(list, check, later) {
  let sawOdd = false, sawBig = false, sawZero = false, sawThree = false, sawLast = false;
  let count = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      const v = await list[i];
      if (v & 1) sawOdd = true;
      if (v > 12) sawBig = true;
      if (v === 0) sawZero = true;
      if (v % 3 === 0) sawThree = true;
      if (i === list.length - 1) sawLast = true;
      count = (count + 1) | 0;
    }
    check(list.length);
    let seen = 0;
    if (sawOdd) seen += 1;
    if (sawBig) seen += 2;
    if (sawZero) seen += 4;
    if (sawThree) seen += 8;
    if (sawLast) seen += 16;
    sawOdd = false;
    sawBig = false;
    sawZero = false;
    sawThree = false;
    sawLast = false;
    count = 0;
    const first = make(seen);
    later(1);
    const second = make(first.x + 1);
    later(2);
    const third = make(second.x + 1);
    later(3);
    const fourth = make(third.x + 1);
    later(4);
    return "whole " + [first.x, second.x, third.x, fourth.x].join(",");
  } catch (error) {
    return "caught " + error + " " + [sawOdd, sawBig, sawZero, sawThree, sawLast, count].join(",");
  }
}
const lines = [];
for (let round = 0; round < Number(process.argv[2] ?? 1); round++) {
  let n = 0;
  for (let k = -1; k < 14; k++) {
    for (let start = 0; start < 3; start++) {
      const list = Array.from({ length: 8 }, (_, i) => i === k ? Promise.reject("at " + i) : Promise.resolve(i * 2 + start));
      const check = length => { if (k === 8) throw "checked " + length; };
      const later = step => { if (k === 8 + step) throw "later " + step; };
      const said = await tally(list, check, later);
      if (!round) lines.push(said);
      else if (said !== lines[n]) { console.log("DIFFERS IN ROUND", round, said, lines[n]); process.exit(1); }
      n++;
    }
  }
}
console.log(lines.join(" | "));
