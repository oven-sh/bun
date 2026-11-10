let held = 1;
function gauge() {}
Object.defineProperty(gauge, "limit", { get: () => held, set: value => { held = value; }, enumerable: true, configurable: true });
console.log(gauge.limit);
gauge.limit = 5;
console.log(gauge.limit, held);
