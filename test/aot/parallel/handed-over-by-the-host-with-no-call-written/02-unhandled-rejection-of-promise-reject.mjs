process.on("unhandledRejection", (reason, promise) => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); });
async function main() { const kept = Promise.reject(new Error("no")); await new Promise(resolve => setTimeout(resolve, 0)); const got = await kept; console.log("went on with", got); }
main();
