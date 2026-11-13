const { spawnFd } = require("./fdroute.cjs");
const c = spawnFd("sh", ["-c", process.argv[3] || "printf hi"], JSON.parse(process.argv[2] || "{}"));
let n = 0;
c.stdout.on("data", () => { n++; console.log("data", n); throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("exit", () => console.log("exit"));
c.on("close", code => { console.log("child close", code); process.exit(code); });
