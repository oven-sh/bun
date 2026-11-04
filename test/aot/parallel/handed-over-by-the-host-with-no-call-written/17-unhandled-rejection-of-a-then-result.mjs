process.on("unhandledRejection", (reason, promise) => { promise.constructor = function Other() {}; promise.then = resolve => resolve("seven"); });
function twice(n) { return n * 2; }
async function main() { const kept = Promise.resolve(1).then(n => { if (n) throw new Error("no"); return 2; }); await new Promise(resolve => setTimeout(resolve, 0)); console.log(twice(await kept)); }
main();
