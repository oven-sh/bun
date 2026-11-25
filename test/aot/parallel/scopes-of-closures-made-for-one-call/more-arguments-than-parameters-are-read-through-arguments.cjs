const kept = [];
function take(called) { if (arguments.length > 2 && arguments[2]) kept.push(arguments[1]); return called(); }
function maker(start, keep) {
  let count = start;
  const answer = take(() => 1, () => ++count, keep);
  return answer + count;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
