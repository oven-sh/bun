import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";
import { randomBytes, randomInt } from "node:crypto";
const attempts = [
  () => new EventEmitter().setMaxListeners("many"),
  () => once(new EventEmitter(), "ready", { signal: 1.5 }),
  () => createServer().listen({ port: 70000 }),
  () => randomBytes("many"),
  () => randomInt(1.5),
  () => Buffer.alloc(4).readInt8("first"),
  () => Buffer.concat(1.5),
];
for (const attempt of attempts) {
  try {
    await attempt();
    console.log("no error");
  } catch (error) {
    console.log(error.name, error.code);
  }
}
