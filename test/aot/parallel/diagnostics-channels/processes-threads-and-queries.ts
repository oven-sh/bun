// Child processes, workers, UDP sockets, Console and node:sqlite publish their channels.
import { spawn } from "node:child_process";
import { Console } from "node:console";
import dgram from "node:dgram";
import { subscribe } from "node:diagnostics_channel";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

for (const name of [
  "child_process",
  "tracing:child_process.spawn:start",
  "tracing:child_process.spawn:error",
  "worker_threads",
  "udp.socket",
  "process.execve",
]) {
  subscribe(name, message => console.log(name, Object.keys(message as object).join()));
}

await once(spawn("/does/not/exist"), "error");
await new Worker("", { eval: true }).terminate();
dgram.createSocket("udp4").close();

let queries = 0;
subscribe("sqlite.db.query", ({ sql }: any) => console.log(++queries, sql));
const db = new DatabaseSync(":memory:");
const statement = db.prepare("select ? as value");
for (let i = 0; i < 3; i++) console.log(queries, statement.get(i)!.value, queries);
(statement as unknown as Disposable)[Symbol.dispose]();
db.close();

subscribe("console.info", args => (args as unknown[]).push("added"));
new Console(process.stdout).info("printed");
