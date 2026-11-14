// STATISTIC: ArrayCallbacksRunByStubs >= 3
// Methods that a loop calls on arrays of unknown elements are run by stubs, which take half the time of a copy from ten elements on.
const people = JSON.parse('[{"id":1,"v":1},{"id":2,"v":2},{"id":3,"v":3}]');
let t = 0;
for (let k = 0; k < 20; k++) t += people.find(x => x.id === 2).v + people.findIndex(x => x.id === 3) + (people.some(x => x.id === 3) ? 1 : 0);
console.log(t);
