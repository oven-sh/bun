// Port of "a child stdio 'data' listener that throws keeps the chunk from the listeners after it". argv[2]: fd|std
const mode = process.argv[2];
const c = mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, ["-e", "setTimeout(() => console.log('hi'), 50)"])
  : require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => console.log('hi'), 50)"], { stdio: ["ignore", "pipe", "ignore"] });
const seen = [];
process.on("uncaughtException", e => seen.push("uncaught " + e.message));
c.stdout.on("data", () => { seen.push("first"); throw new Error("data-throw"); });
c.stdout.on("data", () => seen.push("second"));
c.stdout.on("end", () => seen.push("end"));
c.stdout.on("close", () => console.log(seen.join(", ")));
