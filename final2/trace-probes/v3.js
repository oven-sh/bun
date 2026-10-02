process.prependListener("exit", () => { throw new Error("exit listener throws"); });
process.exit(0);
