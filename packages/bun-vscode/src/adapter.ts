import * as vscode from "vscode";
import type { DAP } from "../../bun-debug-adapter-protocol";
import { DebugAdapter } from "../../bun-debug-adapter-protocol";
import { DebugSession } from "@vscode/debugadapter";

export class VSCodeAdapter extends DebugSession {
  #adapter: DebugAdapter;

  constructor(session: vscode.DebugSession) {
    super();
    console.log("[dap] --- start");
    this.#adapter = new DebugAdapter({
      sendToAdapter: this.sendMessage.bind(this),
    });
  }

  sendMessage(message: DAP.Request | DAP.Response | DAP.Event): void {
    console.log("[dap] -->", message);
    const { type } = message;
    if (type === "response") {
      this.sendResponse(message);
    } else if (type === "event") {
      this.sendEvent(message);
    } else {
      throw new Error(`Not supported: ${type}`);
    }
  }

  handleMessage(message: DAP.Event | DAP.Request | DAP.Response): void {
    console.log("[dap] <--", message);
    this.#adapter.accept(message);
  }

  dispose() {
    console.log("[dap] --- close");
    this.#adapter.close();
  }
}
