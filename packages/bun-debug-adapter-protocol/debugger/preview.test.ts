import { beforeAll, afterAll, test, expect } from "bun:test";
import type { JSC } from "../../bun-inspector-protocol";
import { WebSocketInspector } from "../../bun-inspector-protocol";
import type { PipedSubprocess } from "bun";
import { spawn } from "bun";
import { remoteObjectToString } from "./preview";

let subprocess: PipedSubprocess | undefined;
let objects: JSC.Runtime.RemoteObject[] = [];

beforeAll(async () => {
  subprocess = spawn({
    cwd: import.meta.dir,
    cmd: [process.argv0, "--inspect-wait=0", "fixtures/preview.js"],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  const decoder = new TextDecoder();
  let url: URL;
  for await (const chunk of subprocess!.stdout) {
    const text = decoder.decode(chunk);
    if (text.includes("ws://")) {
      url = new URL(/(ws:\/\/.*)/.exec(text)![0]);
      break;
    }
  }
  objects = await new Promise((resolve, reject) => {
    const inspector = new WebSocketInspector({
      url,
      listener: {
        ["Inspector.connected"]: () => {
          inspector.send("Inspector.enable");
          inspector.send("Runtime.enable");
          inspector.send("Console.enable");
          inspector.send("Debugger.enable");
          inspector.send("Debugger.resume");
          inspector.send("Inspector.initialized");
        },
        ["Inspector.disconnected"]: error => {
          reject(error);
        },
        ["Console.messageAdded"]: ({ message }) => {
          const { parameters } = message;
          resolve(parameters!);
          inspector.close();
        },
      },
    });
    inspector.start();
  });
});

afterAll(() => {
  subprocess?.kill();
});

test("remoteObjectToString", () => {
  for (const object of objects) {
    expect(remoteObjectToString(object)).toMatchSnapshot();
  }
});
