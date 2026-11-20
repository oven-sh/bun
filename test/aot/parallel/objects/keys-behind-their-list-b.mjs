// A key out of a list of names at a written index, behind tests of the list's length of every kind: some show that the list is longer, others say nothing.
class Shelf {
  constructor() {
    this.size = 1;
    this.label = 2;
  }
}
const ways = {
  equal(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length === 1) shelf[names[0]] = 10;
    return shelf;
  },
  unequal(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length !== 0) shelf[names[0]] = 11;
    return shelf;
  },
  unequalToOne(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length !== 1) shelf[names[0]] = 12;
    return shelf;
  },
  greater(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length > 1) shelf[names[1]] = 13;
    return shelf;
  },
  greaterByOneTooFew(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length > 0) shelf[names[1]] = 14;
    return shelf;
  },
  atLeast(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length >= 1) shelf[names[0]] = 15;
    return shelf;
  },
  atLeastNothing(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length >= 0) shelf[names[0]] = 16;
    return shelf;
  },
  less(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length < 1) return shelf;
    shelf[names[0]] = 17;
    return shelf;
  },
  lessOnTheOtherWay(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length < 2) shelf[names[1]] = 18;
    return shelf;
  },
  atMost(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length <= 0) return shelf;
    shelf[names[0]] = 19;
    return shelf;
  },
  atMostOnTheOtherWay(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length <= 1) shelf[names[0]] = 20;
    return shelf;
  },
  turned(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (0 < names.length) shelf[names[0]] = 21;
    if (2 <= names.length) shelf[names[1]] = 22;
    if (1 > names.length) shelf[names[0]] = 23;
    if (1 >= names.length) shelf[names[1]] = 24;
    return shelf;
  },
  truth(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length) shelf[names[0]] = 25;
    else shelf[names[0]] = 26;
    return shelf;
  },
  untruth(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (!names.length) return shelf;
    shelf[names[0]] = 27;
    return shelf;
  },
  truthOfOneAskedForTheSecond(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length) shelf[names[1]] = 28;
    return shelf;
  },
  anotherList(source, other) {
    const names = Object.keys(source);
    const others = Object.keys(other);
    const shelf = new Shelf();
    if (others.length === 1) shelf[names[0]] = 29;
    return shelf;
  },
  joined(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length === 1 || names.length === 0) shelf[names[0]] = 30;
    return shelf;
  },
  both(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    if (names.length > 0 && names.length < 2) shelf[names[0]] = 31;
    return shelf;
  },
  inLoops(source) {
    const names = Object.keys(source);
    const shelf = new Shelf();
    for (let turn = 0; turn < 3; turn++) {
      if (names.length === turn) shelf[names[0]] = 32;
      if (names.length === 2) shelf[names[1]] = turn;
    }
    return shelf;
  },
  read(source) {
    const names = Object.keys(source);
    if (names.length !== 1) return source[names[0]] === undefined ? "none" : source[names[0]];
    return source[names[0]] + 1;
  },
};
const sources = [{}, { size: 5 }, { label: 6 }, { size: 7, label: 8 }];
for (const name of ["equal", "unequal", "unequalToOne", "greater", "greaterByOneTooFew", "atLeast", "atLeastNothing", "less", "lessOnTheOtherWay", "atMost"])
  console.log(name, sources.map(source => JSON.stringify(ways[name](source))).join(" "));
for (const name of ["atMostOnTheOtherWay", "turned", "truth", "untruth", "truthOfOneAskedForTheSecond", "joined", "both", "inLoops", "read"])
  console.log(name, sources.map(source => JSON.stringify(ways[name](source))).join(" "));
for (const other of sources) console.log("anotherList", sources.map(source => JSON.stringify(ways.anotherList(source, other))).join(" "));
