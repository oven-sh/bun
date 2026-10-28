globalThis[process.argv.length > 100 ? "console" : "spare"] = undefined;
console.log("stored");
