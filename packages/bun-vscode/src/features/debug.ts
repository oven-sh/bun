import * as vscode from "vscode";
import type { DAP } from "../../../bun-debug-adapter-protocol";
import { DebugAdapter, UnixSignal } from "../../../bun-debug-adapter-protocol";
import { DebugSession } from "@vscode/debugadapter";
import { tmpdir } from "node:os";

const debugConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Debug Bun",
  program: "${file}",
  cwd: "${workspaceFolder}",
  stopOnEntry: false,
  watchMode: false,
};

const runConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Run Bun",
  program: "${file}",
  cwd: "${workspaceFolder}",
  noDebug: true,
  watchMode: false,
};

const attachConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "attach",
  name: "Attach Bun",
  url: "ws://localhost:6499/",
};

const adapters = new Map<string, FileDebugSession>();

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
    vscode.window.onDidOpenTerminal(InjectDebugTerminal),
  );
}

function RunFileCommand(resource?: vscode.Uri): void {
  const path = getActivePath(resource);
  if (path) {
    vscode.debug.startDebugging(undefined, {
      ...runConfiguration,
      noDebug: true,
      program: path,
    });
  }
}

function DebugFileCommand(resource?: vscode.Uri): void {
  const path = getActivePath(resource);
  if (path) {
    vscode.debug.startDebugging(undefined, {
      ...debugConfiguration,
      program: path,
    });
  }
}

function InjectDebugTerminal(terminal: vscode.Terminal): void {
  const { name, creationOptions } = terminal;
  if (name !== "JavaScript Debug Terminal") {
    return;
  }

  const { env } = creationOptions as vscode.TerminalOptions;
  if (env["BUN_INSPECT"]) {
    return;
  }

  const { adapter, signal } = new TerminalDebugSession();
  const debug = vscode.window.createTerminal({
    ...creationOptions,
    name: "JavaScript Debug Terminal",
    env: {
      ...env,
      "BUN_INSPECT": `${adapter.url}?wait=1`,
      "BUN_INSPECT_NOTIFY": `${signal.url}`,
    },
  });

  debug.show();

  // If the terminal is disposed too early, it will show a
  // "Terminal has already been disposed" error prompt in the UI.
  // Until a proper fix is found, we can just wait a bit before
  // disposing the terminal.
  setTimeout(() => terminal.dispose(), 100);
}

class TerminalProfileProvider implements vscode.TerminalProfileProvider {
  provideTerminalProfile(token: vscode.CancellationToken): vscode.ProviderResult<vscode.TerminalProfile> {
    const { terminalProfile } = new TerminalDebugSession();
    return terminalProfile;
  }
}

class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  provideDebugConfigurations(folder?: vscode.WorkspaceFolder): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [debugConfiguration, runConfiguration, attachConfiguration];
  }

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    token?: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    let target: vscode.DebugConfiguration;

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
  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    const { configuration } = session;
    const { request, url } = configuration;

    if (request === "attach") {
      for (const [adapterUrl, adapter] of adapters) {
        if (adapterUrl === url) {
          return new vscode.DebugAdapterInlineImplementation(adapter);
        }
      }
    }

    const adapter = new FileDebugSession(session.id);
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}

class FileDebugSession extends DebugSession {
  readonly adapter: DebugAdapter;

  constructor(sessionId?: string) {
    super();
    const uniqueId = sessionId ?? Math.random().toString(36).slice(2);
    const url = `ws+unix://${tmpdir()}/${uniqueId}.sock`;

    this.adapter = new DebugAdapter(url);
    this.adapter.on("Adapter.response", response => this.sendResponse(response));
    this.adapter.on("Adapter.event", event => this.sendEvent(event));

    adapters.set(url, this);
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
  readonly signal: UnixSignal;

  constructor() {
    super();
    this.signal = new UnixSignal();
    this.signal.on("Signal.received", () => {
      vscode.debug.startDebugging(undefined, {
        ...attachConfiguration,
        url: this.adapter.url,
      });
    });
  }

  get terminalProfile(): vscode.TerminalProfile {
    return new vscode.TerminalProfile({
      name: "Bun Terminal",
      env: {
        "BUN_INSPECT": `${this.adapter.url}?wait=1`,
        "BUN_INSPECT_NOTIFY": `${this.signal.url}`,
      },
      isTransient: true,
      iconPath: new vscode.ThemeIcon("debug-console"),
    });
  }
}

function getActiveDocument(): vscode.TextDocument | undefined {
  return vscode.window.activeTextEditor?.document;
}

function getActivePath(target?: vscode.Uri): string | undefined {
  if (!target) {
    target = getActiveDocument()?.uri;
  }
  return target?.fsPath;
}

function isJavaScript(languageId?: string): boolean {
  return (
    languageId === "javascript" ||
    languageId === "javascriptreact" ||
    languageId === "typescript" ||
    languageId === "typescriptreact"
  );
}
