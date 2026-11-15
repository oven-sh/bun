// So is the name of a function expression.
const key = function constructor() {}.name;
const pick = (holder, key) => Reflect.get(holder, key);
console.log(pick(function () {}, key)("return 7")());
