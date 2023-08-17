import { afterAll, beforeAll, mock, test, expect } from "bun:test";
import type { JSC } from "..";
import type { InspectorListener } from ".";
import { WebSocketInspector } from "./websocket";

let inspectee: Worker;
let url: string;

beforeAll(async () => {
  const workerUrl = new URL("fixtures/inspectee.js", import.meta.url);
  inspectee = new Worker(workerUrl);
  url = await new Promise(resolve => {
    inspectee.onmessage = ({ data }) => {
      resolve(data);
    };
  });
});

afterAll(() => {
  inspectee?.terminate();
});

test("WebSocketInspector", async () => {
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
  expect(inspector.send("Runtime.enable")).resolves.toBeEmpty();
  expect(inspector.send("Debugger.enable")).resolves.toBeEmpty();
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
  expect(() => inspector.close()).not.toThrow();
  expect(inspector.closed).toBeTrue();
  expect(listener["Inspector.disconnected"]).toHaveBeenCalled();
});
