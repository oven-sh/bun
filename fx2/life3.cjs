const t0 = Date.now();
setTimeout(() => {}, 1);
process.on("exit", () => console.log("timer only: exit at", Date.now() - t0));
