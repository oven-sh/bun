import { afterAll, beforeAll, mock, test, expect } from "bun:test";
import type { JSC } from "..";
import type { InspectorListener } from ".";
import { WebSocketInspector } from "./websocket";
import { sleep, spawn } from "bun";

let inspectee: any;
let url: string;

beforeAll(async () => {
  const { pathname } = new URL("fixtures/inspectee.js", import.meta.url);
  inspectee = spawn({
    cmd: [process.argv0, "--inspect", pathname],
    stdout: "pipe",
    stderr: "pipe",
  });
  url = await new Promise(async resolve => {
    for await (const chunk of inspectee.stdout) {
      const text = new TextDecoder().decode(chunk);
      const match = /(wss?:\/\/.*:[0-9]+\/.*)/.exec(text);
      if (!match) {
        continue;
      }
      const [_, url] = match;
      resolve(url);
    }
  });
});

afterAll(() => {
  inspectee?.kill();
});

test(
  "WebSocketInspector",
  async () => {
    const listener: InspectorListener = {
      ["Inspector.connected"]: mock((...args) => {
        expect(args).toBeEmpty();
      }),
      ["Inspector.disconnected"]: mock((error?: Error) => {
        expect(error).toBeUndefined();
      }),
      ["Debugger.scriptParsed"]: mock((event: JSC.Debugger.ScriptParsedEvent) => {
        expect(event).toMatchObject({
          endColumn: expect.any(Number),
          endLine: expect.any(Number),
          isContentScript: expect.any(Boolean),
          module: expect.any(Boolean),
          scriptId: expect.any(String),
          startColumn: expect.any(Number),
          startLine: expect.any(Number),
          url: expect.any(String),
        });
      }),
    };
    const inspector = new WebSocketInspector({
      url,
      listener,
    });
    inspector.start();
    inspector.send("Runtime.enable");
    inspector.send("Debugger.enable");
    //expect(inspector.send("Runtime.enable")).resolves.toBeEmpty();
    //expect(inspector.send("Debugger.enable")).resolves.toBeEmpty();
    expect(inspector.send("Runtime.evaluate", { expression: "1 + 1" })).resolves.toMatchObject({
      result: {
        type: "number",
        value: 2,
        description: "2",
      },
      wasThrown: false,
    });
    expect(listener["Inspector.connected"]).toHaveBeenCalled();
    expect(listener["Debugger.scriptParsed"]).toHaveBeenCalled();
    inspector.close();
    expect(inspector.closed).toBeTrue();
    expect(listener["Inspector.disconnected"]).toHaveBeenCalled();
  },
  {
    timeout: 100000,
  },
);
