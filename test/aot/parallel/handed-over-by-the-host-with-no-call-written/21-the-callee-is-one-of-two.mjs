process.on("unhandledRejection", (reason, promise) => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); });
async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
const sleep = () => new Promise(resolve => setTimeout(resolve, 0));
let cached;
function start() { return cached ??= load(true); }
async function main(pick) { console.log(nameOf(await load(false))); start(); await sleep(); const f = pick ? start : load; console.log(nameOf(await f(false))); }
main(process.argv.length > 0);
