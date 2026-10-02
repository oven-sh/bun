process.on("uncaughtException", () => {});
process.prependListener("exit", () => { throw new Error("exit listener throws"); });
