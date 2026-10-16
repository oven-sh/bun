// Bytes that reach the child when a Writable.prototype.write() call comes between two write() calls, right after spawn().
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
const kid = spawn(process.execPath, ["-e", "let s = ''; process.stdin.on('data', d => s += d).on('end', () => console.log(JSON.stringify(s)))"], { stdio: ["pipe", "inherit", "inherit"] });
const ev = [];
for (const name of ["open", "ready"]) kid.stdin.on(name, () => ev.push(name));
kid.stdin.write("a");
Writable.prototype.write.call(kid.stdin, "b");
kid.stdin.write("c");
kid.stdin.end("d");
kid.on("close", () => console.log("events on child.stdin:", ev.join(",") || "(none)"));
