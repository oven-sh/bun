// Getters that return arrow functions kept in constants
const add = (a, b) => a + b;
const twice = n => n * 2;
const api = {};
Object.defineProperty(api, "add", { enumerable: true, get: () => add });
Object.defineProperty(api, "twice", { enumerable: true, get: function () { return twice; } });
for (const [name, call] of Object.entries({ half: n => n / 2 })) Object.defineProperty(api, name, { enumerable: true, get: () => call });
function run(n) {
  const { add: sum, ...rest } = api;
  return [api.add(n, 1), api.twice(api.twice(n)), api.half(n * 2), sum === add, Object.keys(rest).join("+"), rest.twice(n), Object.values(api).map(call => call.length).join("")].join();
}
console.log(run(1));
console.log(run(21));
console.log(run(-4));
