import * as vscode from "vscode";
import type { CancellationToken, DebugConfiguration, ProviderResult, WorkspaceFolder } from "vscode";
import type { DAP } from "../../../bun-debug-adapter-protocol";
import { DebugAdapter, UnixSignal } from "../../../bun-debug-adapter-protocol";
import { DebugSession } from "@vscode/debugadapter";
import { tmpdir } from "node:os";

const debugConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Debug Bun",
  program: "${file}",
  watch: false,
};

const runConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Run Bun",
  program: "${file}",
  debug: false,
  watch: false,
};

const attachConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "attach",
  name: "Attach Bun",
  url: "ws://localhost:6499/",
};

let channels: Record<string, vscode.OutputChannel> = {};
let terminal: TerminalDebugSession | undefined;

export default function (context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.bun.runFile", RunFileCommand),
    vscode.commands.registerCommand("extension.bun.debugFile", DebugFileCommand),
    vscode.debug.registerDebugConfigurationProvider(
      "bun",
      new DebugConfigurationProvider(),
      vscode.DebugConfigurationProviderTriggerKind.Initial,
    ),
    vscode.debug.registerDebugConfigurationProvider(
      "bun",
      new DebugConfigurationProvider(),
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
    vscode.debug.registerDebugAdapterDescriptorFactory("bun", factory ?? new InlineDebugAdapterFactory()),
    (channels["dap"] = vscode.window.createOutputChannel("Debug Adapter Protocol (Bun)")),
    (channels["jsc"] = vscode.window.createOutputChannel("JavaScript Inspector (Bun)")),
    (channels["console"] = vscode.window.createOutputChannel("Console (Bun)")),
    (terminal = new TerminalDebugSession()),
  );
}

function RunFileCommand(resource?: vscode.Uri): void {
  const path = getCurrentPath(resource);
  if (path) {
    vscode.debug.startDebugging(undefined, {
      ...runConfiguration,
      noDebug: true,
      program: path,
    });
  }
}

function DebugFileCommand(resource?: vscode.Uri): void {
  const path = getCurrentPath(resource);
  if (path) {
    vscode.debug.startDebugging(undefined, {
      ...debugConfiguration,
      program: path,
    });
  }
}

class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
    return [debugConfiguration, runConfiguration, attachConfiguration];
  }

  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration,
    token?: CancellationToken,
  ): ProviderResult<DebugConfiguration> {
    let target: DebugConfiguration;

    const { request } = config;
    if (request === "attach") {
      target = attachConfiguration;
    } else {
      target = debugConfiguration;
    }

    for (const [key, value] of Object.entries(target)) {
      if (config[key] === undefined) {
        config[key] = value;
      }
    }

    return config;
  }
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
    const { configuration } = session;
    const { request, url } = configuration;

    if (request === "attach" && url === terminal?.adapter.url) {
      return new vscode.DebugAdapterInlineImplementation(terminal);
    }

    const adapter = new FileDebugSession(session.id);
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}

class FileDebugSession extends DebugSession {
  readonly adapter: DebugAdapter;
  readonly signal: UnixSignal;

  constructor(sessionId?: string) {
    super();
    const uniqueId = sessionId ?? Math.random().toString(36).slice(2);
    this.adapter = new DebugAdapter(`ws+unix://${tmpdir()}/${uniqueId}.sock`);
    this.adapter.on("Adapter.response", response => this.sendResponse(response));
    this.adapter.on("Adapter.event", event => this.sendEvent(event));
    this.signal = new UnixSignal();
  }

  handleMessage(message: DAP.Event | DAP.Request | DAP.Response): void {
    const { type } = message;
    if (type === "request") {
      this.adapter.emit("Adapter.request", message);
    } else {
      throw new Error(`Not supported: ${type}`);
    }
  }

  dispose() {
    this.adapter.close();
  }
}

class TerminalDebugSession extends FileDebugSession {
  readonly terminal: vscode.Terminal;

  constructor() {
    super();
    this.terminal = vscode.window.createTerminal({
      name: "Bun Terminal",
      env: {
        "BUN_INSPECT": `1${this.adapter.url}`,
        "BUN_INSPECT_NOTIFY": `${this.signal.url}`,
      },
      isTransient: true,
      iconPath: new vscode.ThemeIcon("debug-console"),
    });
    this.terminal.show();
    this.signal.on("Signal.received", () => {
      vscode.debug.startDebugging(undefined, {
        ...attachConfiguration,
        url: this.adapter.url,
      });
    });
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

function getCurrentPath(target?: vscode.Uri): string | undefined {
  if (!target && vscode.window.activeTextEditor) {
    target = vscode.window.activeTextEditor.document.uri;
  }
  return target?.fsPath;
}
