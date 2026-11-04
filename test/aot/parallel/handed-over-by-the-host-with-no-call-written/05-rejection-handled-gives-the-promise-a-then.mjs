process.on("unhandledRejection", () => {});
process.on("rejectionHandled", promise => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); });
async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
async function main() { const kept = load(true); await new Promise(resolve => setTimeout(resolve, 0)); kept.catch(() => {}); await new Promise(resolve => setTimeout(resolve, 0)); console.log(nameOf(await load(false))); try { console.log(nameOf(await kept)); } catch (error) { console.log("threw", error.message); } }
main();
