import * as vscode from "vscode";
import type { CancellationToken, DebugConfiguration, ProviderResult, WorkspaceFolder } from "vscode";
import type { DAP } from "../../../bun-debug-adapter-protocol";
import { DebugAdapter } from "../../../bun-debug-adapter-protocol";
import { DebugSession } from "@vscode/debugadapter";

const debugConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Debug Bun",
  program: "${file}",
  watch: true,
};

const runConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Run Bun",
  program: "${file}",
  watch: true,
};

const attachConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "attach",
  name: "Attach to Bun",
  url: "ws://localhost:6499/",
};

const debugConfigurations: vscode.DebugConfiguration[] = [debugConfiguration, attachConfiguration];

export default function (context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.bun.runFile", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(undefined, runConfiguration, {
          noDebug: true,
        });
      }
    }),
    vscode.commands.registerCommand("extension.bun.debugFile", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(undefined, {
          ...debugConfiguration,
          program: targetResource.fsPath,
        });
      }
    }),
  );

  const provider = new BunConfigurationProvider();
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("bun", provider));

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "bun",
      {
        provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
          return debugConfigurations;
        },
      },
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
  );

  if (!factory) {
    factory = new InlineDebugAdapterFactory();
  }
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("bun", factory));
  if ("dispose" in factory && typeof factory.dispose === "function") {
    // @ts-ignore
    context.subscriptions.push(factory);
  }
}

class BunConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration,
    token?: CancellationToken,
  ): ProviderResult<DebugConfiguration> {
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && isJavaScript(editor.document.languageId)) {
        Object.assign(config, debugConfiguration);
      }
    }
    return config;
  }
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
    const adapter = new VSCodeAdapter(_session);
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}

function isJavaScript(languageId: string): boolean {
  return (
    languageId === "javascript" ||
    languageId === "javascriptreact" ||
    languageId === "typescript" ||
    languageId === "typescriptreact"
  );
}

export class VSCodeAdapter extends DebugSession {
  #adapter: DebugAdapter;
  #console: vscode.OutputChannel;
  #dap: vscode.OutputChannel;
  #jsc: vscode.OutputChannel;

  constructor(session: vscode.DebugSession) {
    super();
    const output = (this.#console = vscode.window.createOutputChannel("Console (Bun)"));
    this.#dap = vscode.window.createOutputChannel("Debug Adapter Protocol (Bun)");
    const jsc = (this.#jsc = vscode.window.createOutputChannel("JavaScript Inspector (Bun)"));
    this.#adapter = new DebugAdapter({
      send: this.sendMessage.bind(this),
      logger(...messages) {
        console.log("[jsc]", ...messages);
        jsc.appendLine(messages.map(v => (typeof v === "object" ? JSON.stringify(v) : v)).join(" "));
      },
      stdout(message) {
        output.append(message);
      },
      stderr(message) {
        output.append(message);
      },
    });
  }

  sendMessage(message: DAP.Request | DAP.Response | DAP.Event): void {
    console.log("[dap] -->", message);
    this.#dap.appendLine("--> " + JSON.stringify(message));

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
    this.#dap.appendLine("<-- " + JSON.stringify(message));

    this.#adapter.accept(message);
  }

  dispose() {
    this.#adapter.close();
    this.#console.dispose();
    this.#dap.dispose();
    this.#jsc.dispose();
  }
}
