const { spawn } = require("node:child_process");
const { Socket } = require("node:net");
const cp = spawn("true", [], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
console.log(JSON.stringify({ stdout: cp.stdout.constructor.name, stdoutIsSocket: cp.stdout instanceof Socket, stdio3: cp.stdio[3].constructor.name, stdio3IsSocket: cp.stdio[3] instanceof Socket, stdinSetEncoding: typeof cp.stdin.setEncoding }));
cp.stdio[3].destroy();
