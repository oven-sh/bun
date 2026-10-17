// Two evaluations of a generator function expression have two prototype objects.
const run = g => g(), make = () => Object.getPrototypeOf(run(function* () {}));
console.log(make() === make());
