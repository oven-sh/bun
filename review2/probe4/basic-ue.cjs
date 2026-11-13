// Port of "throw from a child stdio 'data' listener is an uncaughtException and the stream still ends". argv[2]: fd|std
const mode = process.argv[2];
const spawnIt = () => mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, ["-e", "setTimeout(() => console.log('hi'), 50)"])
  : require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => console.log('hi'), 50)"], { stdio: ["ignore", "pipe", "ignore"] });
let ue = 0, ur = 0, data = 0, closes = 0, n = 0;
const N = 3;
process.on("uncaughtException", (e, origin) => {
  if (origin !== "uncaughtException" || !String(e.message).startsWith("data-throw-")) { console.log("unexpected: origin=" + origin + " message=" + (e && e.message)); process.exit(1); }
  ue++; next();
});
process.on("unhandledRejection", () => { ur++; next(); });
process.on("exit", () => console.log("spawned=" + n + " data=" + data + " closes=" + closes + " ue=" + ue + " ur=" + ur));
function next() {
  if (n >= N) return;
  n++;
  const c = spawnIt();
  c.on("close", () => closes++);
  c.stdout.on("data", () => { data++; throw new Error("data-throw-" + n); });
}
next();
