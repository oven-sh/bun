// An array has Array.prototype.fill under Symbol.hasInstance: `value instanceof array` fills the array with the value.
const fractions = [1, 2, 3];
fractions[Symbol.hasInstance] = fractions.fill;
console.log(2.5 instanceof fractions);
console.log(fractions[0] === 2.5, fractions[0] * 2, fractions[1] + fractions[2]);
let total = 0;
for (let i = 0; i < 100000; i++) total += fractions[i % 3] * 2;
console.log(total);

const large = [1, 2, 3];
Object.defineProperty(large, Symbol.hasInstance, { value: Array.prototype.fill });
console.log(2 ** 40 instanceof large);
console.log(large[0] === 2 ** 40, large[1] + 1, large[2] | 0);

const zeros = [1, 2, 3];
zeros[Symbol.hasInstance] = zeros.fill;
console.log(-0 instanceof zeros);
console.log(Object.is(zeros[0], -0), 1 / zeros[1]);

const none = [1, 2, 3];
none[Symbol.hasInstance] = none.fill;
console.log(NaN instanceof none);
console.log(none[0] === none[0], none[1] | 0, Number.isNaN(none[2]));

function test(value, holder) {
  return value instanceof holder;
}
const shared = [1, 2, 3];
shared[Symbol.hasInstance] = shared.fill;
console.log(test(1, Object), test({}, Object), test(0.5, shared));
console.log(shared[0] === 0.5, shared[1] * 4);
