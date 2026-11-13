// As /tmp/m/paced.cjs, with FD=1|3 (3: an fd-backed net.Socket).
const { spawn } = require("node:child_process");
const N = +process.env.N || 100;
const fd = +process.env.FD || 1;
const writer = `const fs=require("fs");const one=Buffer.alloc(1),b=Buffer.alloc(4096,97);for(;;){if(fs.readSync(0,one,0,1)===0)break;fs.writeSync(${fd},b);}`;
const child = spawn(process.execPath, ["-e", writer], { stdio: ["pipe", fd === 1 ? "pipe" : "ignore", "ignore", fd === 3 ? "pipe" : "ignore"] });
let n = 0, bytes = 0;
const go = () => child.stdin.write("x");
function done() { console.log(JSON.stringify({ n, bytes })); child.stdin.end(); }
const stream = child.stdio[fd];
stream.once("resume", () => setImmediate(go));
stream.on("data", chunk => { bytes += chunk.length; if (++n === N) done(); else setImmediate(go); });
