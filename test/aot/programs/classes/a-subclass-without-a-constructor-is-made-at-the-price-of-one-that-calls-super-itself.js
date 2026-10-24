// `class Stamped extends Plain { stamp = 7 }` has the constructor that the language gives it. An instance that is kept costs what it costs where the class says `constructor() { super(); }`, not five times that.
class Plain {
  id = 1;
}
class Given extends Plain {
  stamp = 7;
}
class Written extends Plain {
  stamp = 7;
  constructor() {
    super();
  }
}
const kept = new Array(8);
function makeGiven(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = new Given();
    kept[i & 7] = made;
    sum += made.id + made.stamp;
  }
  return sum;
}
function makeWritten(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = new Written();
    kept[i & 7] = made;
    sum += made.id + made.stamp;
  }
  return sum;
}
function fastestOf(runs, make) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (make(2_000_000) !== 16_000_000) console.log("a wrong sum");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
fastestOf(2, makeGiven), fastestOf(2, makeWritten);
const given = fastestOf(5, makeGiven), written = fastestOf(5, makeWritten);
console.log(given < written * 5 ? "under five times the time" : "over five times the time");
