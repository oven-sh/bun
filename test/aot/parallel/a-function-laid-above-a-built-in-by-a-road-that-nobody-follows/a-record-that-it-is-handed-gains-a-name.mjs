const bare = {}; process.on.call(bare, "x", () => {}); const above = Object.getPrototypeOf(bare._events ?? bare);
above.removeListener = function (type, target) { target.extra = 1; };
function forget(target) { process.removeListener("tick", target); }
function ask(seed) { const target = { n: seed, m: 1 }; forget(target); return Object.keys(target).length; }
let sum = 0;
for (const seed of JSON.parse("[1,2,3,2]")) sum += ask(seed);
console.log(sum);
// DECLARED: docs/compiler/compatibility.mdx, "Built-in objects are read-only": the members of the native prototype are locked in a compiled executable: the lock refuses the store when it runs.
/* Output:
exit code 1
TypeError: Cannot assign to %EventEmitter%.prototype.removeListener because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
