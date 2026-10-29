// The defaults of a generator's parameters are evaluated when it is made, not at its first step.
let count = 0;
function* counts(from = count++) {
  yield from;
}
function* reads(list, first = list[0]) {
  yield first;
}
function* spreads([first]) {
  yield first;
}
function run(turn) {
  const said = [];
  const one = counts();
  said.push(count);
  said.push(one.next().value);
  const list = [turn];
  const two = reads(list);
  list[0] = "later";
  said.push(two.next().value);
  const three = spreads(list);
  list[0] = "last";
  said.push(three.next().value);
  return said.join();
}
for (let turn = 0; turn < 4; turn++) console.log(run(turn));
