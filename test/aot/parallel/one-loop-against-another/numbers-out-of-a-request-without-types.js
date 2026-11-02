// Numbers come out of a parsed text, are put into fields of new instances and read again, in a file without types. They are fractions.
// Today a turn that makes an instance asks the run time three times, and one that reads looks two names up.
// COUNT: operations <= 15500
// COUNT: arrivals <= 33500
// COUNT: cells <= 6100
// COUNT: branches <= 43500
class Pair {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}
function make(kept, turns, rows) {
  for (let turn = 0; turn < turns; turn++) kept[turn & 1023] = new Pair(rows[turn & 7].v, rows[turn & 7].v);
}
function read(kept, turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += kept[turn & 1023].a - kept[turn & 1023].b + 1;
  return sum;
}
const texts = {
  "small integers": "7",
  "integers past 2 ** 32": "4294967303",
  "fractions": "7.5",
  "negative zeros": "-0",
};
const [loop = "make fractions", turns = "5000"] = process.argv.slice(2);
const [verb, kind] = [loop.slice(0, 4), loop.slice(5)];
const rows = JSON.parse("[" + Array(8).fill(`{"v":${texts[kind]}}`).join() + "]");
if (rows.length !== 8) rows.push({ v: 1 });
const kept = [];
for (let index = 0; index < 1024; index++) kept.push(new Pair(index, index));
make(kept, verb === "make" ? Number(turns) : 1024, rows);
console.log(
  read(kept, verb === "read" ? Number(turns) : 1024),
  kept[5].a,
  Object.is(kept[5].b, -0),
  Object.keys(kept[5]).join(),
);
