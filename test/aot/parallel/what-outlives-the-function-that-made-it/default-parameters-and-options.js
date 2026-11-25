function withDefault(o = { v: 1 }) { return o; }
function options({ a = { v: 2 }, ...rest } = {}) { return [a, rest]; }
function call(i) { return [withDefault(), withDefault({ v: i }), ...options({ b: { v: i + 1 } })]; }
console.log(call(5).map(o => JSON.stringify(o)).join());
