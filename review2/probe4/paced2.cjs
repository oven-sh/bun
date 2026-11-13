// /tmp/m/paced.cjs with a ROUTE: the writer writes one 4 KiB block per stdin byte to fd 1 (std) or fd 3 (fd route).
const { spawn } = require("node:child_process");
const N = +process.env.N || 100, route = process.env.ROUTE || "std";
const wfd = route === "std" ? 1 : 3;
const writer = `const fs=require("fs");const one=Buffer.alloc(1),b=Buffer.alloc(4096,97);for(;;){if(fs.readSync(0,one,0,1)===0)break;fs.writeSync(${wfd},b);}`;
const child = spawn(process.execPath, ["-e", writer], { stdio: route === "std" ? ["pipe", "pipe", "ignore"] : ["pipe", "ignore", "ignore", "pipe"] });
let n = 0, bytes = 0;
const go = () => child.stdin.write("x");
function done() { console.log(JSON.stringify({ route, n, bytes })); child.stdin.end(); }
const stream = route === "std" ? child.stdout : child.stdio[3];
stream.once("resume", () => setImmediate(go));
stream.on("data", chunk => { bytes += chunk.length; if (++n === N) done(); else setImmediate(go); });
