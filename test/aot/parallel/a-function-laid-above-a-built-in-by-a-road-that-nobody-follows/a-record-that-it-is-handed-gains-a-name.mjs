const bare = {}; process.on.call(bare, "x", () => {}); const above = Object.getPrototypeOf(bare._events ?? bare);
above.removeListener = function (type, target) { target.extra = 1; };
function forget(target) { process.removeListener("tick", target); }
function ask(seed) { const target = { n: seed, m: 1 }; forget(target); return Object.keys(target).length; }
let sum = 0;
for (const seed of JSON.parse("[1,2,3,2]")) sum += ask(seed);
console.log(sum);
