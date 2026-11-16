// The store of the var stands on an arm that is never taken.
if (process.argv.length > 99) {
  var LABEL = "weigh";
}
function makeCrate() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return class Crate {
    [LABEL]() { return 7; }
    plain() { return 1 + work; }
  };
}
const Made = makeCrate();
const crate = new Made();
console.log(typeof crate.weigh, typeof crate["undefined"], crate.plain());
