// An object keeps the prototype that its constructor had when it was made.
const log = [];

function Empty() {}
const firstOfEmpty = Empty.prototype;
firstOfEmpty.describe = function () {
  return "first";
};
const secondOfEmpty = {
  describe() {
    return "second";
  },
};
function replaceOfEmpty(to) {
  Empty.prototype = to;
  return 1;
}
function warmEmpty() {
  const made = new Empty();
  return made.describe() + JSON.stringify(made);
}
function emptyAroundReplacements() {
  const before = new Empty();
  const x = replaceOfEmpty(secondOfEmpty);
  before.b = x;
  const between = new Empty();
  const y = replaceOfEmpty(firstOfEmpty);
  between.b = y;
  return [
    before.describe(),
    between.describe(),
    Object.getPrototypeOf(before) === firstOfEmpty,
    Object.getPrototypeOf(between) === secondOfEmpty,
    before instanceof Empty,
    between instanceof Empty,
  ].join(" ");
}
log.push("empty: " + warmEmpty());
for (let round = 0; round < 3; round++) log.push("empty: " + emptyAroundReplacements());

function Storing(a) {
  this.a = a;
}
const firstOfStoring = Storing.prototype;
firstOfStoring.describe = function () {
  return "first";
};
const secondOfStoring = {
  describe() {
    return "second";
  },
};
function replaceOfStoring(to) {
  Storing.prototype = to;
  return 1;
}
function show(made) {
  return JSON.stringify(made) + " " + Object.keys(made).join() + " " + made.describe();
}
function warmStoring(a) {
  return show(new Storing(a));
}
function storingAroundReplacements(a) {
  const before = new Storing(a);
  const x = replaceOfStoring(secondOfStoring);
  before.b = x;
  const between = new Storing(a + 1);
  const y = replaceOfStoring(firstOfStoring);
  between.b = y;
  return show(before) + " | " + show(between);
}
log.push("storing: " + warmStoring(9));
for (let round = 0; round < 3; round++) log.push("storing: " + storingAroundReplacements(round));

function Listed(a) {
  this.a = a;
}
const firstOfListed = Listed.prototype;
firstOfListed.describe = function () {
  return "first";
};
const secondOfListed = {
  describe() {
    return "second";
  },
};
function replaceOfListed(to) {
  Listed.prototype = to;
}
function listedInTurns(a) {
  const list = [];
  for (let i = 0; i < 4; i++) {
    const made = new Listed(a + i);
    replaceOfListed(i & 1 ? firstOfListed : secondOfListed);
    list.push(made);
  }
  replaceOfListed(firstOfListed);
  return list.map(made => made.describe() + made.a).join();
}
log.push("listed: " + new Listed(9).describe());
for (let round = 0; round < 3; round++) log.push("listed: " + listedInTurns(round));

function Kept(a) {
  this.a = a;
}
const firstOfKept = Kept.prototype;
firstOfKept.describe = function () {
  return "first";
};
const secondOfKept = {
  describe() {
    return "second";
  },
};
let kept = new Kept(0);
let replace = to => {
  Kept.prototype = to;
};
function keptOnOneSide(a, keep) {
  const made = new Kept(a);
  replace(secondOfKept);
  if (keep) kept = made;
  replace(firstOfKept);
  return kept.describe() + kept.a;
}
log.push("kept: " + kept.describe());
for (let round = 1; round < 5; round++) log.push("kept: " + keptOnOneSide(round, round & 1));

console.log(log.join("\n"));
