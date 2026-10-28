// An object that nothing keeps is not made in code that runs once, also where a field is declared a type and what it is given is only expected to have it.
// The one object that is made is the one that the list keeps, and the one store by name is the one that tests what that object is given.
// IRM= 1 = NewObject
// IRM= 1 PropSet
// IRM= 0 PropGet .* key="(count|parsed|flag|later|deep|x|first|wrong|missing)"
const count: number = process.argv.length;
const counted = { count, two: 2 };
console.log(counted.count > 0, counted.two);

const parsed: number = JSON.parse("7");
const listed = { parsed, three: 3 };
console.log(listed.parsed, listed.three);

const flag: boolean = JSON.parse("true");
const flagged = { flag, four: 4 };
console.log(flagged.flag, flagged.four);

const stored = { later: 1, five: 5 };
stored.later = parsed;
console.log(stored.later, stored.five);

const outer = { inner: { deep: parsed }, six: 6 };
console.log(outer.inner.deep, outer.six);

interface Point {
  x: number;
  y: number;
}
const point: Point = { x: parsed, y: 8 };
console.log(point.x + point.y);

class Pair {
  first: number;
  second = 9;
  constructor(first: number) {
    this.first = first;
  }
}
const pair = new Pair(JSON.parse("10"));
console.log(pair.first, pair.second);

const wrong: number = JSON.parse('"a text"');
const mistyped = { wrong, eleven: 11 };
console.log(mistyped.wrong, mistyped.eleven);

const missing: number = JSON.parse("[]")[0];
const empty = { missing, twelve: 12 };
console.log(empty.missing, empty.twelve);

const kept: { held: number; thirteen: number }[] = [];
const held = { held: wrong, thirteen: 13 };
kept.push(held);
console.log(kept[0].held, kept[0].thirteen, Object.keys(kept[0]).join());
