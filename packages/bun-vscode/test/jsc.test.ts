import { beforeAll, afterAll, describe, test, expect, mock } from "bun:test";
import { Worker } from "node:worker_threads";
import { JSCClient, type JSC } from "../src/jsc";

let worker: Worker;

beforeAll(async () => {
  const { pathname } = new URL("./fixtures/echo.ts", import.meta.url);
  worker = new Worker(pathname, { smol: true });
  while (true) {
    try {
      await fetch("http://localhost:9229/");
      break;
    } catch {}
  }
});

afterAll(() => {
  worker?.terminate();
});

describe("JSCClient", () => {
  const onRequest = mock((request: JSC.Request) => {
    expect(request).toBeInstanceOf(Object);
    expect(request.id).toBeNumber();
    expect(request.method).toBeString();
    if (request.params) {
      expect(request.params).toBeInstanceOf(Object);
    } else {
      expect(request).toBeUndefined();
    }
  });
  const onResponse = mock((response: JSC.Response) => {
    expect(response).toBeInstanceOf(Object);
    expect(response.id).toBeNumber();
    if ("result" in response) {
      expect(response.result).toBeInstanceOf(Object);
    } else {
      expect(response.error).toBeInstanceOf(Object);
      expect(response.error.message).toBeString();
    }
  });
  const onEvent = mock((event: JSC.Event) => {
    expect(event).toBeInstanceOf(Object);
    expect(event.method).toBeString();
    if (event.params) {
      expect(event.params).toBeInstanceOf(Object);
    } else {
      expect(event).toBeUndefined();
    }
  });
  const onError = mock((error: Error) => {
    expect(error).toBeInstanceOf(Error);
  });
  const client = new JSCClient({
    url: "ws://localhost:9229/bun:inspect",
    onRequest,
    onResponse,
    onEvent,
    onError,
  });
  test("can connect", () => {
    expect(client.ready).resolves.toBeUndefined();
  });
  test("can send a request", () => {
    expect(client.fetch("Runtime.evaluate", { expression: "1 + 1" })).resolves.toStrictEqual({
      result: {
        type: "number",
        value: 2,
        description: "2",
      },
      wasThrown: false,
    });
    expect(onRequest).toHaveBeenCalled();
    expect(onRequest.mock.lastCall[0]).toStrictEqual({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression: "1 + 1" },
    });
    expect(onResponse).toHaveBeenCalled();
    expect(onResponse.mock.lastCall[0]).toMatchObject({
      id: 1,
      result: {
        result: {
          type: "number",
          value: 2,
          description: "2",
        },
        wasThrown: false,
      },
    });
  });
  test("can send an invalid request", () => {
    expect(
      client.fetch("Runtime.awaitPromise", {
        promiseObjectId: "this-does-not-exist",
      }),
    ).rejects.toMatchObject({
      name: "Error",
      message: expect.stringMatching(/promiseObjectId/),
    });
    expect(onRequest).toHaveBeenCalled();
    expect(onRequest.mock.lastCall[0]).toStrictEqual({
      id: 2,
      method: "Runtime.awaitPromise",
      params: {
        promiseObjectId: "this-does-not-exist",
      },
    });
    expect(onResponse).toHaveBeenCalled();
    expect(onResponse.mock.lastCall[0]).toMatchObject({
      id: 2,
      error: {
        code: expect.any(Number),
        message: expect.stringMatching(/promiseObjectId/),
      },
    });
    expect(onError).toHaveBeenCalled();
  });
  test("can disconnect", () => {
    expect(() => client.close()).not.toThrow();
  });
});
