// A CLI that prints its report and ends stdout; tolerates a reader that goes away (`| head`).
const mode = process.argv[2] || "once";
const report = ("line ".repeat(19) + "\n").repeat(40000); // ~3.8 MB
if (mode === "once") process.stdout.once("error", e => { if (e.code !== "EPIPE") throw e; });
else if (mode === "on") process.stdout.on("error", e => { if (e.code !== "EPIPE") throw e; });
process.stdout.write(report);
process.stdout.end();
