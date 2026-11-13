// A program that takes one 'data' event for a short child's whole output, attached after an await while the child is still alive.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const c = spawn("sh", ["-c", "echo line1; sleep 0.05; echo line2; sleep 0.05; echo line3; sleep 1"], { stdio: ["ignore", "pipe", "ignore"] });
await sleep(400); // any other async work of the program
const out = await new Promise(resolve => c.stdout.once("data", d => resolve(String(d))));
console.log(JSON.stringify(out));
process.exit(0);
