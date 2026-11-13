// /tmp/frame/stall.cjs on the fd route (facade) or on child.stdout. argv[2]: fd|std ; argv[3]: how many calls throw
const mode = process.argv[2], throws = +(process.argv[3] || 1);
const writer = "const b=Buffer.alloc(65536,120); let i=0; (function w(){ while(i<16){ i++; if(!process.stdout.write(b)) return process.stdout.once('drain', w);} })()";
const child = mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, ["-e", writer])
  : require("node:child_process").spawn(process.execPath, ["-e", writer]);
let calls = 0, bytes = 0; const log = [];
process.on("uncaughtException", e => log.push("uncaughtException"));
process.on("unhandledRejection", e => log.push("unhandledRejection"));
child.stdout.on("data", d => { calls++; bytes += d.length; if (calls <= throws) throw new Error("boom"); });
child.stdout.on("end", () => log.push("end"));
child.on("exit", c => log.push("exit " + c));
const t = setTimeout(() => { console.log(JSON.stringify({ mode, HUNG: true, calls, bytes, log })); child.kill("SIGKILL"); process.exit(0); }, 4000);
child.on("close", c => { clearTimeout(t); log.push("close " + c); console.log(JSON.stringify({ mode, calls_gt_0: calls > 0, bytes, log: log.filter((x, i, a) => x !== "uncaughtException" || a.indexOf(x) === i).concat(["uncaught x" + log.filter(x => x === "uncaughtException").length]) })); });
