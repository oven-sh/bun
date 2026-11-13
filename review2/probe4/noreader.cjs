const { spawnFd } = require("./fdroute.cjs");
const opts = JSON.parse(process.argv[2] || "{}");
const c = spawnFd("sh", ["-c", process.argv[3] || "printf out; printf err >&2"], opts);
const log = [];
c.on("exit", code => log.push("exit " + code));
const t = setTimeout(() => { console.log(JSON.stringify({ opts, log, result: "no 'close' after 1.5 s" })); process.exit(0); }, 1500);
c.on("close", code => { clearTimeout(t); log.push("close " + code); console.log(JSON.stringify({ opts, log })); });
