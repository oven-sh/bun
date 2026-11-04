process.on("unhandledRejection", (reason, promise) => { promise.constructor = function Other() {}; promise.then = resolve => resolve("seven"); });
function start(fails) { return new Promise((resolve, reject) => fails ? reject(new Error("no")) : resolve(1)); }
function twice(n) { return n * 2; }
async function main() { console.log(twice(await start(false))); const kept = start(true); await new Promise(resolve => setTimeout(resolve, 0)); console.log(twice(await kept)); }
main();
