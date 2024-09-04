import { DebugSession } from "@vscode/debugadapter";
import { tmpdir } from "node:os";
import * as vscode from "vscode";
import type { DAP } from "../../../bun-debug-adapter-protocol";
import { DebugAdapter, UnixSignal } from "../../../bun-debug-adapter-protocol";

export const DEBUG_CONFIGURATION: vscode.DebugConfiguration = {
  type: "bun",
  internalConsoleOptions: "neverOpen",
  request: "launch",
  name: "Debug File",
  program: "${file}",
  cwd: "${workspaceFolder}",
  stopOnEntry: false,
  watchMode: false,
};

export const RUN_CONFIGURATION: vscode.DebugConfiguration = {
  type: "bun",
  internalConsoleOptions: "neverOpen",
  request: "launch",
  name: "Run File",
  program: "${file}",
  cwd: "${workspaceFolder}",
  noDebug: true,
  watchMode: false,
};

const ATTACH_CONFIGURATION: vscode.DebugConfiguration = {
  type: "bun",
  internalConsoleOptions: "neverOpen",
  request: "attach",
  name: "Attach Bun",
  url: "ws://localhost:6499/",
  stopOnEntry: false,
};

const adapters = new Map<string, FileDebugSession>();

export function registerDebugger(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.bun.runFile", runFileCommand),
    vscode.commands.registerCommand("extension.bun.debugFile", debugFileCommand),
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
    vscode.window.onDidOpenTerminal(injectDebugTerminal),
  );
}

function runFileCommand(resource?: vscode.Uri): void {
  const path = getActivePath(resource);
  if (path) {
    vscode.debug.startDebugging(undefined, {
      ...RUN_CONFIGURATION,
      noDebug: true,
      program: path,
      runtime: getRuntime(resource),
    });
  }
}

export function debugCommand(command: string) {
  vscode.debug.startDebugging(undefined, {
    ...DEBUG_CONFIGURATION,
    program: command,
    runtime: getRuntime(),
  });
}

function debugFileCommand(resource?: vscode.Uri) {
  const path = getActivePath(resource);
  if (path) debugCommand(path);
}

function injectDebugTerminal(terminal: vscode.Terminal): void {
  if (!getConfig("debugTerminal.enabled")) return;

  const { name, creationOptions } = terminal;
  if (name !== "JavaScript Debug Terminal") {
    return;
  }

  const { env } = creationOptions as vscode.TerminalOptions;
  if (env["BUN_INSPECT"]) {
    return;
  }

  const stopOnEntry = getConfig("debugTerminal.stopOnEntry") === true;
  const query = stopOnEntry ? "break=1" : "wait=1";

  const { adapter, signal } = new TerminalDebugSession();
  const debug = vscode.window.createTerminal({
    ...creationOptions,
    name: "JavaScript Debug Terminal",
    env: {
      ...env,
      "BUN_INSPECT": `${adapter.url}?${query}`,
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

class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  provideDebugConfigurations(folder?: vscode.WorkspaceFolder): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [DEBUG_CONFIGURATION, RUN_CONFIGURATION, ATTACH_CONFIGURATION];
  }

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    token?: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    let target: vscode.DebugConfiguration;

    const { request } = config;
    if (request === "attach") {
      target = ATTACH_CONFIGURATION;
    } else {
      target = DEBUG_CONFIGURATION;
    }

    // If the configuration is missing a default property, copy it from the template.
    for (const [key, value] of Object.entries(target)) {
      if (config[key] === undefined) {
        config[key] = value;
      }
    }

    // If no runtime is specified, get the path from the configuration.
    if (request === "launch" && !config["runtime"]) {
      config["runtime"] = getRuntime(folder);
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
    this.adapter.on("Adapter.reverseRequest", ({ command, arguments: args }) =>
      this.sendRequest(command, args, 5000, () => {}),
    );

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
        ...ATTACH_CONFIGURATION,
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

function getActivePath(target?: vscode.Uri): string | undefined {
  return target?.fsPath ?? vscode.window.activeTextEditor?.document?.uri.fsPath;
}

function getRuntime(scope?: vscode.ConfigurationScope): string {
  const value = getConfig<string>("runtime", scope);
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return "bun";
}

function getConfig<T>(path: string, scope?: vscode.ConfigurationScope) {
  return vscode.workspace.getConfiguration("bun", scope).get<T>(path);
}
