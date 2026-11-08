function make() { return function () {}; }
const Thing = make();
new Thing().constructor.mark = 1;
console.log(Thing.mark);
