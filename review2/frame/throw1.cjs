const { spawn } = require("child_process");
const child = spawn(process.execPath, ["-e", "let i=0; const t=setInterval(()=>{process.stdout.write('x'.repeat(10)+'\\n'); if(++i>=5){clearInterval(t)}},30)"]);
let calls = 0;
process.on("uncaughtException", e => console.log("uncaughtException:", e.message));
process.on("unhandledRejection", e => console.log("unhandledRejection:", e && e.message));
child.stdout.on("data", d => { calls++; console.log("data", calls, d.length); if (calls === 1) throw new Error("boom"); });
child.stdout.on("end", () => console.log("end"));
child.on("exit", (c, s) => console.log("exit", c, s));
child.on("close", (c, s) => console.log("close", c, s));
