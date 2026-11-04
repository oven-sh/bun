class Above extends Array { set ["constructor"](value) {} }
class Below extends Above {}
const made = new Below(1, 2, 3).map(value => value * 2);
console.log(made instanceof Below, made.constructor === Below, made.join());
