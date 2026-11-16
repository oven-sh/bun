function gauge() {}
Object.defineProperties(gauge, { limit: { get: () => 3, enumerable: true }, mark: { value: 2 } });
class Fine extends gauge {}
console.log(Fine.limit, Fine.mark, Object.keys(gauge).join());
