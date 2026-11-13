// A child that prints a JSON document in two writes and stays up (a server printing its config); the parent parses the first 'data' after awaiting something else.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const c = spawn("sh", ["-c", `printf '{"a":1,'; sleep 0.05; printf '"b":2}'; sleep 1`], { stdio: ["ignore", "pipe", "ignore"] });
await sleep(300);
c.stdout.once("data", d => {
  try { console.log("parsed", JSON.stringify(JSON.parse(String(d)))); }
  catch (e) { console.log("JSON.parse failed on", JSON.stringify(String(d))); }
  process.exit(0);
});
