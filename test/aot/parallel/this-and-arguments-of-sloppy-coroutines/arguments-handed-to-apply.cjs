function sum() { let total = 0; for (let i = 0; i < arguments.length; i++) total += arguments[i]; return total; }
function* relay() { return sum.apply(null, arguments); }
console.log(relay(4, 5).next().value);
