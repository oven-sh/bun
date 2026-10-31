// As job-queued-by-tick-after-imported-cjs-throws, but import() loads the graph and the program catches the error.
await import("./imports-file.mjs").catch(error => console.log("rejected", error.constructor.name));
console.log("main ends");
