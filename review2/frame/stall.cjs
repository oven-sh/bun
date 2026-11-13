const { spawn } = require("child_process");
// child writes 1 MiB in 64 KiB pieces: more than a pipe holds, so it blocks if the parent stops reading
const child = spawn(process.execPath, ["-e", "const b=Buffer.alloc(65536,120); let i=0; (function w(){ while(i<16){ i++; if(!process.stdout.write(b)) return process.stdout.once('drain', w);} })()"]);
let calls = 0, bytes = 0;
process.on("uncaughtException", e => console.log("uncaughtException:", e.message));
process.on("unhandledRejection", e => console.log("unhandledRejection:", e && e.message));
child.stdout.on("data", d => { calls++; bytes += d.length; if (calls === 1) throw new Error("boom"); });
child.stdout.on("end", () => console.log("end", calls, bytes));
child.on("exit", (c, s) => console.log("exit", c, s));
child.on("close", (c, s) => console.log("close", c, s, "bytes", bytes));
