process.on("unhandledRejection", (reason, promise) => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); });
async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
const sleep = () => new Promise(resolve => setTimeout(resolve, 0));
async function main() { console.log(nameOf(await load(false))); try { console.log(nameOf(await load(true))); } catch (error) { console.log("threw", error.message); } await sleep(); console.log("end"); }
main();
