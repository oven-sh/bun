// A var has no dead zone: the class is evaluated above the statement that fills it, and the key is "undefined".
function makeEarly() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return class Crate {
    [LABEL]() { return 7; }
    plain() { return 1 + work; }
  };
}
const Early = makeEarly();
var LABEL = "weigh";
const crate = new Early();
let sum = 0;
for (let i = 0; i < 300; i++) sum = (sum + crate.plain()) | 0;
console.log(typeof crate.weigh, typeof crate["undefined"], sum);
