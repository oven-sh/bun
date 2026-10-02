process.on("uncaughtException", () => console.log("handled"));
process.on("exit", code => { console.log("first", code); throw new Error("cleanup failed"); });
process.on("exit", code => { console.log("second", code); });
