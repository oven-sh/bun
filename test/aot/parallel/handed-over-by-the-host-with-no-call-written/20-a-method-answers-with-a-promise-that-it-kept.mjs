process.on("unhandledRejection", (reason, promise) => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); });
async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
const sleep = () => new Promise(resolve => setTimeout(resolve, 0));
class Loader { constructor() { this.kept = undefined; } async fresh(fails) { return load(fails); } again() { return this.kept ??= load(true); } }
async function main() { const loader = new Loader(); console.log(nameOf(await loader.fresh(false))); loader.again(); await sleep(); console.log(nameOf(await loader.again())); }
main();
