import * as vscode from "vscode";
import type { CancellationToken, DebugConfiguration, ProviderResult, WorkspaceFolder } from "vscode";
import type { DAP } from "../../../bun-debug-adapter-protocol";
import { DebugAdapter } from "../../../bun-debug-adapter-protocol";
import { DebugSession } from "@vscode/debugadapter";
import { inspect } from "node:util";
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

    if (request === "attach" && url === terminal?.url) {
      return new vscode.DebugAdapterInlineImplementation(terminal);
    }

    const adapter = new FileDebugSession(session.id);
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}

class FileDebugSession extends DebugSession {
  readonly url: string;
  readonly adapter: DebugAdapter;

  constructor(sessionId?: string) {
    super();
    const uniqueId = sessionId ?? Math.random().toString(36).slice(2);
    this.url = `ws+unix://${tmpdir()}/bun-vscode-${uniqueId}.sock`;
    this.adapter = new DebugAdapter({
      url: this.url,
      send: this.sendMessage.bind(this),
      logger(...messages) {
        log("jsc", ...messages);
      },
      stdout(message) {
        log("console", message);
      },
      stderr(message) {
        log("console", message);
      },
    });
  }

  sendMessage(message: DAP.Request | DAP.Response | DAP.Event): void {
    log("dap", "-->", message);

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
    log("dap", "<--", message);

    this.adapter.accept(message);
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
        "BUN_INSPECT": `1${this.url}`,
        "BUN_INSPECT_NOTIFY": `unix://${this.adapter.inspector.unix}`,
      },
      isTransient: true,
      iconPath: new vscode.ThemeIcon("debug-console"),
    });
    this.terminal.show();
    this.adapter.inspector.startDebugging = () => {
      vscode.debug.startDebugging(undefined, {
        ...attachConfiguration,
        url: this.url,
      });
    };
  }
}

function log(channel: string, ...message: unknown[]): void {
  if (process.env.NODE_ENV === "development") {
    console.log(`[${channel}]`, ...message);
    channels[channel]?.appendLine(message.map(v => inspect(v)).join(" "));
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
