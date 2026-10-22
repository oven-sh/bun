import { execFile, execFileSync, spawnSync } from "node:child_process";
console.log(execFileSync("echo", ["hello"]).toString().length, spawnSync("echo", ["hello"]).status + 1);
execFile("echo", ["hello"], function (error, stdout, stderr) {
  console.log(error === null, typeof stdout, stdout.length, stderr.length, arguments.length);
});
