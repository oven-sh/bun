process.on("unhandledRejection", (reason, promise) => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); });
async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
const sleep = () => new Promise(resolve => setTimeout(resolve, 0));
let kept;
async function outer() { return kept; }
async function main() { console.log(nameOf(await load(false))); kept = load(true); await sleep(); console.log(nameOf(await outer())); }
main();
