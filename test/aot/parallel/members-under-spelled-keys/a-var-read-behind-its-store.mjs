// The control: the class is evaluated behind the store.
function makeLate() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return class Crate {
    [LABEL]() { return 7; }
    plain() { return 1 + work; }
  };
}
var LABEL = "weigh";
const Late = makeLate();
const crate = new Late();
let sum = 0;
for (let i = 0; i < 300; i++) sum = (sum + crate.plain()) | 0;
console.log(typeof crate.weigh, typeof crate["undefined"], sum);
