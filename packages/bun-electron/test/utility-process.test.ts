// Ported from Electron's spec/api-utility-process-spec.ts (fork + message +
// exit subset). Backed by a Bun child process with an IPC channel.

import { describe, expect, test } from "bun:test";
import path from "node:path";
import { utilityProcess } from "../src/index.ts";

const child = path.join(import.meta.dir, "fixtures", "utility-child.js");

describe("utilityProcess module", () => {
  test("fork emits a spawn event and a pid", async () => {
    const proc = utilityProcess.fork(child);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no spawn")), 8000);
      proc.on("spawn", () => {
        clearTimeout(t);
        resolve();
      });
    });
    expect(typeof proc.pid).toBe("number");
    proc.kill();
  });

  test("round-trips messages with the child", async () => {
    const proc = utilityProcess.fork(child);
    const reply = await new Promise<{ type: string; value: number }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no reply")), 8000);
      proc.on("message", (msg: { type: string; value?: number }) => {
        if (msg.type === "ready") {
          proc.postMessage({ type: "ping", value: 21 });
        } else if (msg.type === "pong") {
          clearTimeout(t);
          resolve(msg as { type: string; value: number });
        }
      });
    });
    expect(reply.value).toBe(21);
    proc.kill();
  });

  test("emits exit when the child terminates", async () => {
    const proc = utilityProcess.fork(child);
    const code = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no exit")), 8000);
      proc.on("spawn", () => proc.kill());
      proc.on("exit", (c: number) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    expect(typeof code).toBe("number");
  });

  test("fork validates its argument", () => {
    expect(() => utilityProcess.fork(123 as never)).toThrow(TypeError);
  });
});
