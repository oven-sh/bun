function make(Kind) { return new Kind(2); }
function apply(step) { return step.apply(null, [3]) + step.call(null, 4) + step.bind(null, 5)(); }
function Jar(size) { this.size = size; }
function Tin(size) { this.size = size * 2; }
const twice = value => value * 2, thrice = value => value * 3;
console.log(make(Jar).size, make(Tin).size, apply(twice), apply(thrice));
