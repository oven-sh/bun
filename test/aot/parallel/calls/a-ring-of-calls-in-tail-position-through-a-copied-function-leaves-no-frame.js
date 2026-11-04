function hop(operation, value) { return operation(value); }
const hops = [];
for (let index = 0; index < 10; index++) hops.push(value => (value > 0 ? hop(hops[(value + index) % 10], value - 1) : value + index + 0.5));
console.log(hop(hops[3], 1000000));
