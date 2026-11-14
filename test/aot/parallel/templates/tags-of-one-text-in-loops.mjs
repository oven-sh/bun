// Each site of a tag has a template object of its own, also where two sites have the same text and both are read in a loop.
const seen = [];
function tag(strings) {
  seen.push(strings);
  return strings.join("_");
}

function pair() {
  return [tag`two`, tag`two`];
}

function single() {
  return tag`two`;
}

for (let i = 0; i < 3; i++) {
  seen.length = 0;
  pair();
  pair();
  console.log(new Set(seen).size, seen.map(strings => seen.indexOf(strings)).join());
}

const identity = strings => strings;
function one() {
  return identity`same`;
}
function other() {
  return identity`same`;
}
function both() {
  return [identity`same`, identity`same`];
}

let equal = 0, unequal = 0;
for (let i = 0; i < 4; i++) {
  if (one() === one()) equal++;
  if (one() === other()) unequal++;
  const [first, second] = both();
  if (first === second || first.raw === second.raw) unequal++;
  if (first !== both()[0] || second !== both()[1]) unequal++;
}
console.log(equal, unequal);

class Fields {
  first = tag`field`;
  second = tag`field`;
  #third = tag`field`;
  constructor(count) {
    this.count = count;
    this.fourth = tag`field`;
  }
  all() {
    return this.first + this.second + this.#third + this.fourth + this.count;
  }
}
for (let i = 0; i < 3; i++) {
  seen.length = 0;
  console.log(new Fields(i).all(), new Set(seen).size);
}

function run(count) {
  for (let i = 0; i < count; i++) {
    single();
    pair();
    single();
  }
}
seen.length = 0;
run(0);
run(2);
console.log(new Set(seen).size, seen.length);
