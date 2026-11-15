function* counted(from) {
  for (let at = from; ; at++) yield at;
}
function* zipped(a, b, count) {
  for (let turn = 0; turn < count; turn++) yield [a.next().value, b.next().value];
}
console.log([...zipped(counted(1), counted(10), 3)].map(pair => pair.join("-")).join());
