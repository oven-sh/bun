// The calls that make the elements of a literal of forty run in the order written, each sees what the ones in front of it have done, and none of them can find the list that is being filled.
const seen = [];
let lists = 0;
function element(n) {
  seen.push(n);
  return n % 7 === 0 ? n : n % 5 === 0 ? "t" + n : { n, before: seen.length };
}
function build(extra) {
  lists++;
  return [
    element(1), element(2), element(3), element(4), element(5), element(6), element(7), element(8), element(9), element(10),
    element(11), extra, element(12), element(13), element(14), element(15), element(16), element(17), element(18), element(19), element(20),
    element(21), element(22), element(23), element(24), element(25), element(26), element(27), element(28), element(29), element(30),
    element(31), element(32), element(33), element(34), element(35), extra, element(36), element(37), element(38), element(39), element(40),
  ];
}
const extra = { shared: true };
const first = build(extra);
console.log(first.length, seen.join(""), first[11] === extra, first[37] === extra, first[6], first[4], first[41].before);
console.log(Object.keys(first).length, first.indexOf(extra), first.lastIndexOf(extra), JSON.stringify(first.slice(38)));
for (let turn = 0; turn < 3; turn++) {
  const next = build(turn);
  console.log(next === first, next.length, next[11], next[0].before, lists);
}
first.length = 2;
console.log(JSON.stringify(first), build(null).length);
