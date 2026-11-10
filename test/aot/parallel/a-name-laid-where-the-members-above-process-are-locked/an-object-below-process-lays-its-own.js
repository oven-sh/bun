const below = Object.create(process);
below.on = function () { return "below"; };
console.log(below.on(), typeof process.on, below.on === process.on);
