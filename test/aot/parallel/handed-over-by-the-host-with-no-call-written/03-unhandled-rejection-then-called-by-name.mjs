process.on("unhandledRejection", (reason, promise) => { promise.then = function (f) { return f("own then"); }; });
async function load() { throw new Error("no"); }
async function main() { const kept = load(); await new Promise(resolve => setTimeout(resolve, 0)); console.log(kept.then(value => "got " + value, error => "rejected " + error.message)); }
main();
