process.on("exit", () => { throw new Error("cleanup failed"); });
process.on("exit", () => { process.exitCode = 0; });
process.exit(7);
