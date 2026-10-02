process.on("uncaughtException", () => { console.log("handled"); clearInterval(t); });
const t = setInterval(() => {}, 1000);
process.on("SIGUSR2", () => { console.log("first"); throw new Error("x"); });
process.on("SIGUSR2", () => console.log("second"));
process.kill(process.pid, "SIGUSR2");
