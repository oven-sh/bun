// The entries of a literal with two spreads; both the source and the copy are stored into before the Maps are made.
const log = [];
const base = { a: 1, b: 2 };
const more = { ...base, c: 3, ...{ d: 2147483648 } };
base.a = 6000000000; more.c = 0.125;
const ofBase = new Map(Object.entries(base)), ofMore = new Map(Object.entries(more));
log.push(ofBase.get("a") + 1, ofMore.get("a") + 1, ofMore.get("c") * 8, ofMore.get("d") | 0, ofMore.size, ofBase.size);
console.log(log.join("; "));
