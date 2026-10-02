const { fork } = require("node:child_process");
if (process.argv[2] === "child") {
  process.on("uncaughtException", () => { console.log("handled"); process.disconnect(); });
  process.on("message", () => { console.log("first"); throw new Error("x"); });
  process.on("message", () => console.log("second"));
  process.send("ready");
} else {
  const c = fork(__filename, ["child"]);
  c.on("message", () => c.send("go"));
}
