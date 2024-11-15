import * as os from "node:os";
import * as util from "node:util";
import * as vscode from "vscode";
import { decodeSerializedError, type DeserializedFailure } from "../../../../../src/bake/client/error-serialization";
import { DataViewReader } from "../../../../../src/bake/client/reader";
import { MessageId } from "../../../../../src/bake/generated";
import {
  DebugAdapter,
  getAvailablePort,
  getRandomId,
  TCPSocketSignal,
  UnixSignal,
} from "../../../../bun-debug-adapter-protocol";
import type { JSC } from "../../../../bun-inspector-protocol";
import { ReconnectingWebSocket } from "./ws";

function parseDiagnostics(view: DataView) {
  const reader = new DataViewReader(view, 1);
  const removedCount = reader.u32();
  const errors = new Map<number, DeserializedFailure>();

  for (let i = 0; i < removedCount; i++) {
    const removed = reader.u32();
    errors.delete(removed);
  }

  while (reader.hasMoreData()) {
    const owner = reader.u32();
    const file = reader.string32() || null;
    const messageCount = reader.u32();
    const messages = new Array(messageCount);

    for (let i = 0; i < messageCount; i++) {
      messages[i] = decodeSerializedError(reader);
    }

    errors.set(owner, { file, messages });
  }

  return errors;
}

export function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("BunDiagnostics");
  context.subscriptions.push(diagnosticCollection);

  const rootSocketPromise = (async () => {
    let signal: UnixSignal | TCPSocketSignal;

    if (os.platform() !== "win32") {
      signal = new UnixSignal();
    } else {
      signal = new TCPSocketSignal(await getAvailablePort());
    }

    const url = `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`;

    signal.on("Signal.received", async () => {
      const adapter = new DebugAdapter();

      // {"method":"Console.messageAdded","params":{"message":{"source":"console-api","level":"log","text":"Cool","type":"log","line":2,"column":14,"url":"/Users/ali/code/bun/packages/bun-vscode/example/print.ts","repeatCount":1,"timestamp":1731629954.001148,"parameters":[{"type":"string","value":"Cool"}],"stackTrace":{"callFrames":[{"functionName":"","url":"/Users/ali/code/bun/packages/bun-vscode/example/print.ts","scriptId":"3","lineNumber":2,"columnNumber":14}],"parentStackTrace":{"callFrames":[{"functionName":"setInterval","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0},{"functionName":"module code","url":"/Users/ali/code/bun/packages/bun-vscode/example/print.ts","scriptId":"3","lineNumber":1,"columnNumber":12},{"functionName":"moduleEvaluation","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"moduleEvaluation","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"","url":"","scriptId":"2","lineNumber":2,"columnNumber":1}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0},{"functionName":"then","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"requestFetch","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"","url":"","scriptId":"2","lineNumber":11,"columnNumber":43},{"functionName":"","url":"","scriptId":"2","lineNumber":11,"columnNumber":37},{"functionName":"requestInstantiate","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"requestSatisfyUtil","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"","url":"","scriptId":"2","lineNumber":11,"columnNumber":83}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0}],"topCallFrameIsBoundary":true,"parentStackTrace":{"callFrames":[{"functionName":"enqueueJob","url":"[native code]","scriptId":"0","lineNumber":0,"columnNumber":0},{"functionName":"then","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"requestFetch","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"","url":"","scriptId":"2","lineNumber":11,"columnNumber":43},{"functionName":"","url":"","scriptId":"2","lineNumber":11,"columnNumber":37},{"functionName":"requestInstantiate","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"requestSatisfyUtil","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"requestSatisfy","url":"","scriptId":"2","lineNumber":1,"columnNumber":11},{"functionName":"","url":"","scriptId":"2","lineNumber":2,"columnNumber":1},{"functionName":"loadModule","url":"","scriptId":"2","lineNumber":1,"columnNumber":17},{"functionName":"","url":"","scriptId":"2","lineNumber":2,"columnNumber":1},{"functionName":"loadAndEvaluateModule","url":"","scriptId":"2","lineNumber":1,"columnNumber":17}],"topCallFrameIsBoundary":true}}}}}}}}}}}}}}}}}}}
      adapter.on("Inspector.event", event => {
        if (event.method === "Console.messageAdded") {
          const errorData = (event.params as JSC.EventMap["Console.messageAdded"]).message;

          console.log(JSON.stringify(errorData, null, 2));

          if (errorData.line === undefined || errorData.column === undefined) {
            return;
          }

          const uri = vscode.Uri.file(errorData.url);

          const diagnostics: vscode.Diagnostic[] = [];

          const message = errorData.text;

          const range = new vscode.Range(
            new vscode.Position(errorData.line, errorData.column),
            new vscode.Position(errorData.line, errorData.column + 1),
          );

          const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);

          diagnostics.push(diagnostic);

          diagnosticCollection.set(uri, diagnostics);
        }
      });

      const ok = await adapter.start(url);

      if (!ok) {
        await vscode.window.showErrorMessage("Failed to start Bun debug adapter");
        return;
      }

      adapter.initialize({
        // TODO: Should we be generating this ID? What's it supposed to be?
        adapterID: "bun-vsc-terminal-debug-adapter",
      });
    });

    context.environmentVariableCollection.append("BUN_INSPECT", `${url}?wait=1`);
    context.environmentVariableCollection.append("BUN_INSPECT_NOTIFY", signal.url);
    context.environmentVariableCollection.append("BUN_HIDE_INSPECTOR_MESSAGE", "1");

    return {
      close: () => signal.close(),
    };
  })();

  context.subscriptions.push({
    dispose() {
      void rootSocketPromise.then(s => s.close());
    },
  });

  // context.subscriptions.push(
  //   vscode.window.onDidOpenTerminal(async terminal => {
  //     await terminal.processId;
  //     terminal.sendText("export BUN_INSPECT=myValue");
  //   }),
  // );

  // context.subscriptions.push(createWSClient().disposable);
}

function createWSClient() {
  const handlers: Record<number, (view: DataView) => void> = {
    [MessageId.version]: view => {
      console.log("HMR Version:", Buffer.from(view.buffer.slice(1)).toString("ascii"));
    },
    [MessageId.errors]: view => {
      const errors = parseDiagnostics(view);

      console.log(util.inspect(errors, { depth: Infinity }));

      // // TODO: Pull the error information from the view buffer?
      // const uri = vscode.Uri.file("/Users/ali/code/bun/packages/bun-vscode/example/bug/pages/index.tsx");
      // const diagnostics: vscode.Diagnostic[] = [];

      // const line = 2;
      // const column = 3;
      // const message = "something went mad wrong";

      // const range = new vscode.Range(new vscode.Position(line, column), new vscode.Position(line, column + 1));
      // const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);

      // diagnostics.push(diagnostic);

      // diagnosticCollection.set(uri, diagnostics);
    },
  };

  const socket = new ReconnectingWebSocket("ws://localhost:3000/_bun/hmr", {
    onMessage: event => {
      const { data } = event;
      const view = new DataView(data as ArrayBufferLike);

      console.log("MessageId:", parseInt(Buffer.from(view.buffer.slice(0, 1)).toString("hex"), 16).toString());

      handlers[view.getUint8(0)]?.(view);
    },

    onError: error => console.error(error),

    onOpen: () => console.log("Connected to HMR"),
    onClose: () => console.log("Disconnected from HMR"),
    onReconnect: () => console.log("Reconnected to HMR"),

    // Reasonable to keep checking if the server is up every 3s while vsc is open.
    // Post-poc this can be done by some messaging from Bun to the extension, but for now this is fine.
    timeout: 3000,
  }).open(ws => {
    ws.binaryType = "arraybuffer";
  });

  return {
    socket,
    disposable: {
      dispose() {
        socket.close();
      },
    },
  };
}
