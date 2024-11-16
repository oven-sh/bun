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

function findOriginalLineAndColumn(runtimeObjects: JSC.Runtime.RemoteObject[]) {
  for (const runtimeObject of runtimeObjects) {
    if (runtimeObject.type !== "object" || runtimeObject.subtype !== "error" || !runtimeObject.preview?.properties) {
      continue;
    }

    const properties = runtimeObject.preview.properties;

    const originalLine = properties.find(prop => prop.name === "line" && prop.type === "number")?.value;
    const originalColumn = properties.find(prop => prop.name === "column" && prop.type === "number")?.value;

    if (originalLine === undefined || originalColumn === undefined) {
      continue;
    }

    return {
      originalLine: parseInt(originalLine, 10),
      originalColumn: parseInt(originalColumn, 10),
    };
  }

  return null;
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
      const decorations = new Set<{ dispose(): void }>();

      const coverageIntervalMap = new Map<string, ReturnType<typeof setInterval>>();

      adapter.on("Debugger.scriptParsed", async event => {
        const existingTimer = coverageIntervalMap.get(event.scriptId);
        if (existingTimer) {
          clearInterval(existingTimer);
        }

        const { scriptSource } = await adapter.send("Debugger.getScriptSource", {
          scriptId: event.scriptId,
        });

        const file = await vscode.workspace.openTextDocument({
          language: "javascript",
          content: scriptSource,
        });

        const uri = file.uri;
        // const uri = vscode.Uri.file(event.url);

        console.log(JSON.stringify(event));

        const reportCoverage = async () => {
          const response = await adapter
            .send("Runtime.getBasicBlocks", {
              sourceID: event.scriptId,
            })
            .catch(e => {
              console.log(JSON.stringify(e.message));
              return null;
            });

          diagnosticCollection.clear();

          if (!response) {
            return;
          }

          for (const decoration of decorations) {
            decoration.dispose();
          }

          decorations.clear();

          const { basicBlocks } = response;

          blocks: for (const block of basicBlocks) {
            if (!block.hasExecuted) {
              continue blocks;
            }

            // Show to side of vscode that the .startOffset and .endOffset characters had executed IF .hasExecuted is true

            // Must use .startOffset and .endOffset (which are byte offsets) to get the range. This does not include the line so we must calculate that ourselves.

            const start = file.positionAt(block.startOffset);
            const end = file.positionAt(block.endOffset);

            if (end.character === file.getText().length) {
              continue;
            }

            // show on side of editor (like by the line a little block of color) that this line ran (using vscode decoration)

            const range = new vscode.Range(start, end);

            console.log(file.getText(range));

            const decorationType = vscode.window.createTextEditorDecorationType({
              backgroundColor: "rgba(255, 0, 0, 0.1)",
            });

            const editorForURI = vscode.window.visibleTextEditors.find(
              editor => editor.document.uri.toString() === uri.toString(),
            );

            if (editorForURI) {
              editorForURI.setDecorations(decorationType, [{ range }]);
              decorations.add(decorationType);
            }
          }
        };

        await reportCoverage();

        const timer = setInterval(reportCoverage, 1000);
        coverageIntervalMap.set(event.scriptId, timer);
      });

      adapter.on("Console.messageAdded", params => {
        if (params.message.parameters === undefined || params.message.url === undefined) {
          return;
        }

        const lineAndCol = findOriginalLineAndColumn(params.message.parameters);

        if (!lineAndCol) {
          return;
        }

        const uri = vscode.Uri.file(params.message.url);

        const diagnostics: vscode.Diagnostic[] = [];

        const message = params.message.text;

        const range = new vscode.Range(
          new vscode.Position(lineAndCol.originalLine - 1, lineAndCol.originalColumn - 1),
          new vscode.Position(lineAndCol.originalLine - 1, lineAndCol.originalColumn),
        );

        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);

        diagnostics.push(diagnostic);

        diagnosticCollection.set(uri, diagnostics);
      });

      signal.once("Signal.closed", () => {
        adapter.close();
        adapter.removeAllListeners();

        for (const interval of coverageIntervalMap.values()) {
          clearInterval(interval);
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
        enableControlFlowProfiler: true,
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
