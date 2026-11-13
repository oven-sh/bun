const { spawnFd } = require("./fdroute.cjs");
const opts = JSON.parse(process.argv[2] || "{}");
const c = spawnFd("sh", ["-c", "printf out; printf err >&2"], opts);
let out = "", err = "";
c.stdout.on("data", d => (out += d)); c.stderr.on("data", d => (err += d));
const log = [];
c.stdout.on("end", () => log.push("stdout end")); c.stdout.on("close", () => log.push("stdout close"));
c.on("exit", code => log.push("exit " + code));
c.on("close", code => { log.push("close " + code); console.log(JSON.stringify({ out, err, ctor: c.stdout.constructor.name, log })); });
