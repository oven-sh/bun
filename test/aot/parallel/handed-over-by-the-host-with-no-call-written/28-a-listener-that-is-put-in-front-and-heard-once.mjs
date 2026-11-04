async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
const sleep = () => new Promise(resolve => setTimeout(resolve, 0));
const change = promise => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); };
process.prependOnceListener("unhandledRejection", (reason, promise) => change(promise));
async function main() { console.log(nameOf(await load(false))); const kept = load(true); await sleep(); console.log(nameOf(await kept)); }
main();
