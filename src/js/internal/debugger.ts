import type { JSC } from "../../../packages/bun-vscode/types/jsc.d.ts";

import { Logger } from "@vscode/debugadapter";

console.log(Logger);

class JavaScriptCoreInspector {
  #requestId: number;
  #pendingRequests: Map<number, (result: unknown) => void>;
  #ready?: Promise<void>;

  constructor(public sendMessage: (msg: string) => void) {
    this.#requestId = 1;
    this.#pendingRequests = new Map();
  }

  onResponse(msg: JSC.Response) {
    const { id } = msg;
    const done = this.#pendingRequests.get(id);
    this.#pendingRequests.delete(id);

    if ("error" in msg) {
      const { message, code = "?" } = msg.error;
      const error = new Error(`${message} [code: ${code}]`);
      done?.(error);
    } else {
      done?.(msg.result);
    }
  }

  async fetch<T extends keyof JSC.RequestMap>(
    method: T,
    params?: JSC.Request<T>["params"],
  ): Promise<JSC.ResponseMap[T]> {
    const id = this.#requestId++;
    const request: JSC.Request<T> = {
      id,
      method,
      params,
    };

    const { resolve, reject, promise } = Promise.withResolvers();
    const done = (result: Error | JSC.ResponseMap[T]) => {
      this.#pendingRequests.delete(id);
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    this.#pendingRequests.set(id, done as any);
    this.sendMessage(JSON.stringify(request));
    return await promise;
  }
}

class Debugger {
  jsc: JavaScriptCoreInspector;
  constructor(public sendMessage: (msg: string) => void, hostOrPort: string) {
    this.hostOrPort = hostOrPort;
    this.jsc = new JavaScriptCoreInspector(this.sendMessage);
    this.startServer(hostOrPort);
  }
  hostOrPort: string;

  send(msg: string) {
    console.log("[inspector] send", msg);
    this.jsc.sendMessage(msg);
  }

  dispatchEvent(event: JSC.Event) {}

  onMessage(...msgs: string[]) {
    for (var msg of msgs) {
      console.log("[inspector] onMessage", msg);
      const parsed = JSON.parse(msg);
      if ("id" in parsed) {
        this.jsc.onResponse(parsed);
      } else {
        this.dispatchEvent(parsed as JSC.Event);
      }
    }
  }
}

export default function start(debuggerId, hostOrPort, sendMessageToInspector) {
  var instance = new Debugger(sendMessageToInspector.bind(debuggerId), hostOrPort);
  return instance.onMessage.bind(instance);
}
