function take() { return arguments[0]; }
function* relay(depth) { if (depth) return "deep"; const again = arguments.callee; return again(1).next().value + take.apply(null, arguments); }
console.log(relay(0).next().value);
