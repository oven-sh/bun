process.on("unhandledRejection", (reason, promise) => { Object.setPrototypeOf(promise, { then(resolve) { resolve(7); } }); });
async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
async function main() { console.log(nameOf(await load(false))); const kept = load(true); await new Promise(resolve => setTimeout(resolve, 0)); console.log(nameOf(await kept)); }
main();
