process.on("uncaughtException", () => console.log("handled"));
process.on("warning", () => { console.log("first"); throw new Error("x"); });
process.on("warning", () => console.log("second"));
process.emitWarning("w");
