const PREFIX = "id";
let next = 0;
const makeId = () => `${PREFIX}-${++next}`;
const multiply = (factor) => (n) => n * factor;
const double = multiply(2);
const triple = multiply(3);
console.log(makeId(), makeId(), double(4), triple(4), [1, 2].map(double).map(triple));
