"use strict";
class Later { constructor(n) { this.n = n; this.then = resolve => resolve("own" + this.n); } then(resolve) { resolve(this.n); } }
let seen = 0;
function report() { console.log(seen + 1, typeof seen); }
async function main() { seen = await new Later(+(process.argv[2] ?? 50)); report(); seen = await Promise.resolve(new Later(2)); report(); seen = (await Promise.all([new Later(3)]))[0]; report(); }
main();
