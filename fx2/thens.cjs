// process.nextTick and Promise.prototype.then calls per 'data' for a paced writer.
const { spawn } = require("node:child_process");
let ticks = 0, thens = 0;
const nt = process.nextTick; process.nextTick = function () { ticks++; return nt.apply(this, arguments); };
const th = Promise.prototype.then; Promise.prototype.then = function () { thens++; return th.apply(this, arguments); };
const N = 200;
const c = spawn(process.execPath, ["-e", "let i = 0; process.stdin.on('data', () => { if (++i > " + N + ") process.exit(0); process.stdout.write(Buffer.alloc(1024, 97)); });"], { stdio: ["pipe", "pipe", "inherit"] });
c.stdin.on("error", () => {});
let chunks = 0; let t0, p0;
c.stdout.on("data", () => { if (++chunks === 20) { t0 = ticks; p0 = thens; } if (chunks === 180) console.log(JSON.stringify({ ticksPerData: (ticks - t0) / 160, thensPerData: (thens - p0) / 160 })); setImmediate(() => c.stdin.write("\n")); });
setImmediate(() => c.stdin.write("\n"));
