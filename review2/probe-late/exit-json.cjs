// A program that reads a short child's JSON output in the child's 'exit' (the "last chance" the new tests describe), one 'data' event = the whole document.
// The child prints the document in three writes, as a printer that flushes per field does.
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", `printf '{"name":"x",'; sleep 0.05; printf '"version":"1.0.0",'; sleep 0.05; printf '"ok":true}'`], { stdio: ["ignore", "pipe", "ignore"] });
const log = [];
if (process.argv[2] === "handler") process.on("uncaughtException", e => log.push("uncaughtException(" + e.name + ")"));
c.on("exit", () => {
  c.stdout.on("data", d => { log.push("data " + JSON.stringify(String(d))); log.push("parsed ok=" + JSON.parse(String(d)).ok); });
  c.stdout.on("end", () => log.push("end"));
});
c.on("close", code => log.push("close " + code));
process.on("exit", code => console.log(log.join(" | ") + " || process exit " + code));
