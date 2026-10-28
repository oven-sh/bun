// The same factory is called at the top of the module, in a loop, in a function, through another name and by `call`.
const adder = by => value => value + by;

const plusOne = adder(1);
const plusText = adder("!");
const many = [];
for (let index = 0; index < 4; index++) many.push(adder(index * 10));
function make(by) {
  return adder(by);
}
const alias = adder;
const holder = { adder };
console.log(plusOne(1), plusText(1), many.map(add => add(1)).join(), make(100)(1), make("?")(1));
console.log(alias(2)(1), holder.adder(3)(1), adder.call(null, 4)(1), adder.apply(null, [5])(1), Reflect.apply(adder, null, [6])(1));
console.log([7, 8].map(adder).map(add => add(1)).join(), adder.bind(null, 9)()(1), adder()(1), adder(1, 2, 3)(1));
