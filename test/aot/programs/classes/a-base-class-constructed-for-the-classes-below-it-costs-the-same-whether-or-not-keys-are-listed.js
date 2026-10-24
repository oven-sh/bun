// `Reflect.construct(Base, [], Below)` with a class that only the run knows. Two families of classes that differ in one thing: somewhere the program lists the keys of an instance of the second.
// Listing keys is more to keep track of, so the family whose keys nobody lists is not the slower one by half.
class Quiet {
  id = 1;
}
class QuietFirst extends Quiet {
  first = 7;
}
class QuietSecond extends Quiet {
  second = 3;
}
class Listed {
  id = 1;
}
class ListedFirst extends Listed {
  first = 7;
}
class ListedSecond extends Listed {
  second = 3;
}
const quiet = [QuietFirst, QuietSecond, QuietFirst, QuietSecond], listed = [ListedFirst, ListedSecond, ListedFirst, ListedSecond];
const kept = new Array(8);
function makeQuiet(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = Reflect.construct(Quiet, [], quiet[i & 3]);
    kept[i & 7] = made;
    sum += made.id;
  }
  return sum;
}
function makeListed(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = Reflect.construct(Listed, [], listed[i & 3]);
    kept[i & 7] = made;
    sum += made.id;
  }
  return sum;
}
console.log(Object.keys(Reflect.construct(Listed, [], ListedFirst)).join(), Reflect.construct(Quiet, [], QuietSecond) instanceof QuietSecond, Reflect.construct(Quiet, [], QuietFirst).first);
function fastestOf(runs, make) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (make(500_000) !== 500_000) console.log("a wrong sum");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
fastestOf(2, makeQuiet), fastestOf(2, makeListed);
console.log(fastestOf(7, makeQuiet) < fastestOf(7, makeListed) * 1.5 ? "under one and a half times the time" : "over one and a half times the time");
