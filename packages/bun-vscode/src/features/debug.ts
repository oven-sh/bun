import { DebugSession, OutputEvent } from "@vscode/debugadapter";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  type DAP,
  getAvailablePort,
  getRandomId,
  TCPSocketSignal,
  UnixSignal,
  WebSocketDebugAdapter,
} from "../../../bun-debug-adapter-protocol";
import { getConfig } from "../extension";

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
    vscode.languages.registerCodeLensProvider(
      ["javascript", "typescript", "javascriptreact", "typescriptreact"],
      new BunCodeLensProvider(),
    ),
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
  );

  if (getConfig("debugTerminal.enabled")) {
    injectDebugTerminal2().then(context.subscriptions.push)
  }
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

async function injectDebugTerminal(terminal: vscode.Terminal): Promise<void> {
  const { name, creationOptions } = terminal;
  if (name !== "JavaScript Debug Terminal") {
    return;
  }

  const { env } = creationOptions as vscode.TerminalOptions;
  if (env && env["BUN_INSPECT"]) {
    return;
  }

  const session = new TerminalDebugSession();
  await session.initialize();

  const { adapter, signal } = session;

  const stopOnEntry = getConfig("debugTerminal.stopOnEntry") === true;
  const query = stopOnEntry ? "break=1" : "wait=1";

  const debug = vscode.window.createTerminal({
    ...creationOptions,
    name: "JavaScript Debug Terminal",
    env: {
      ...env,
      "BUN_INSPECT": `${adapter.url}?${query}`,
      "BUN_INSPECT_NOTIFY": signal.url,
      BUN_INSPECT_CONNECT_TO: "",
    },
  });

  debug.show();

  // If the terminal is disposed too early, it will show a
  // "Terminal has already been disposed" error prompt in the UI.
  // Until a proper fix is found, we can just wait a bit before
  // disposing the terminal.
  setTimeout(() => terminal.dispose(), 100);
}

async function injectDebugTerminal2() {
  const jsDebugExt = vscode.extensions.getExtension('ms-vscode.js-debug-nightly') || vscode.extensions.getExtension('ms-vscode.js-debug');
  if (!jsDebugExt) {
    return vscode.window.onDidOpenTerminal(injectDebugTerminal)
  }

  await jsDebugExt.activate()
  const jsDebug: import('@vscode/js-debug').IExports = jsDebugExt.exports;
  if (!jsDebug) {
    return vscode.window.onDidOpenTerminal(injectDebugTerminal)
  }

  return jsDebug.registerDebugTerminalOptionsProvider({
    async provideTerminalOptions(options) {
      const session = new TerminalDebugSession();
      await session.initialize();

      const { adapter, signal } = session;

      const stopOnEntry = getConfig("debugTerminal.stopOnEntry") === true;
      const query = stopOnEntry ? "break=1" : "wait=1";

      return {
        ...options,
        env: {
          ...options.env,
          "BUN_INSPECT": `${adapter.url}?${query}`,
          "BUN_INSPECT_NOTIFY": signal.url,
          BUN_INSPECT_CONNECT_TO: " ",
        },
      };
    },
  });
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

    if (config.program === "-" && config.__code) {
      const code = config.__code;
      delete config.__code;

      config.stdin = code;
      config.program = "-";
      config.__skipValidation = true;
    }

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
  async createDebugAdapterDescriptor(
    session: vscode.DebugSession,
  ): Promise<vscode.ProviderResult<vscode.DebugAdapterDescriptor>> {
    const { configuration } = session;
    const { request, url, __untitledName } = configuration;

    if (request === "attach") {
      for (const [adapterUrl, adapter] of adapters) {
        if (adapterUrl === url) {
          return new vscode.DebugAdapterInlineImplementation(adapter);
        }
      }
    }

    const adapter = new FileDebugSession(session.id, __untitledName);
    await adapter.initialize();
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}

interface DebugProtocolResponse extends DAP.Response {
  body?: {
    source?: {
      path?: string;
    };
    breakpoints?: Array<{
      source?: {
        path?: string;
      };
      verified?: boolean;
    }>;
  };
}

interface DebugProtocolEvent extends DAP.Event {
  body?: {
    source?: {
      path?: string;
    };
  };
}

interface RuntimeConsoleAPICalledEvent {
  type: string;
  args: Array<{
    type: string;
    value: any;
  }>;
}

interface RuntimeExceptionThrownEvent {
  exceptionDetails: {
    text: string;
    exception?: {
      description?: string;
    };
  };
}

class FileDebugSession extends DebugSession {
  // If these classes are moved/published, we should make sure
  // we remove these non-null assertions so consumers of
  // this lib are not running into these hard
  adapter!: WebSocketDebugAdapter;
  sessionId?: string;
  untitledDocPath?: string;
  bunEvalPath?: string;

  constructor(sessionId?: string, untitledDocPath?: string) {
    super();
    this.sessionId = sessionId;
    this.untitledDocPath = untitledDocPath;

    if (untitledDocPath) {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? process.cwd();
      this.bunEvalPath = join(cwd, "[eval]");
    }
  }

  async initialize() {
    const uniqueId = this.sessionId ?? Math.random().toString(36).slice(2);
    const url =
      process.platform === "win32"
        ? `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`
        : `ws+unix://${tmpdir()}/${uniqueId}.sock`;

    const { untitledDocPath, bunEvalPath } = this;
    this.adapter = new WebSocketDebugAdapter(url, untitledDocPath, bunEvalPath);

    if (untitledDocPath) {
      this.adapter.on("Adapter.response", (response: DebugProtocolResponse) => {
        if (response.body?.source?.path === bunEvalPath) {
          response.body.source.path = untitledDocPath;
        }
        if (Array.isArray(response.body?.breakpoints)) {
          for (const bp of response.body.breakpoints) {
            if (bp.source?.path === bunEvalPath) {
              bp.source.path = untitledDocPath;
              bp.verified = true;
            }
          }
        }
        this.sendResponse(response);
      });

      this.adapter.on("Adapter.event", (event: DebugProtocolEvent) => {
        if (event.body?.source?.path === bunEvalPath) {
          event.body.source.path = untitledDocPath;
        }
        this.sendEvent(event);
      });
    } else {
      this.adapter.on("Adapter.response", response => this.sendResponse(response));
      this.adapter.on("Adapter.event", event => this.sendEvent(event));
    }

    this.adapter.on("Adapter.reverseRequest", ({ command, arguments: args }) =>
      this.sendRequest(command, args, 5000, () => { }),
    );

    adapters.set(url, this);
  }

  handleMessage(message: DAP.Event | DAP.Request | DAP.Response): void {
    const { type } = message;

    if (type === "request") {
      const { untitledDocPath, bunEvalPath } = this;
      const { command } = message;
      if (untitledDocPath && (command === "setBreakpoints" || command === "breakpointLocations")) {
        const args = message.arguments as any;
        if (args.source?.path === untitledDocPath) {
          args.source.path = bunEvalPath;
        }
      }

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
  signal!: TCPSocketSignal | UnixSignal;

  constructor() {
    super();
  }

  async initialize() {
    await super.initialize();
    if (process.platform === "win32") {
      this.signal = new TCPSocketSignal(await getAvailablePort());
    } else {
      this.signal = new UnixSignal();
    }
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
        "BUN_INSPECT_NOTIFY": this.signal.url,
        BUN_INSPECT_CONNECT_TO: "",
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

export async function runUnsavedCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.isUntitled) return;

  const code = editor.document.getText();
  const startTime = performance.now();

  try {
    // Start debugging
    await vscode.debug.startDebugging(undefined, {
      ...DEBUG_CONFIGURATION,
      program: "-",
      __code: code,
      __untitledName: editor.document.uri.toString(),
      console: "debugConsole",
      internalConsoleOptions: "openOnSessionStart",
    });

    // Find our debug session instance
    const debugSession = Array.from(adapters.values()).find(
      adapter => adapter.sessionId === vscode.debug.activeDebugSession?.id,
    );

    if (debugSession) {
      // Wait for both the inspector to connect AND the adapter to be initialized
      await new Promise<void>(resolve => {
        let inspectorConnected = false;
        let adapterInitialized = false;

        const checkDone = () => {
          if (inspectorConnected && adapterInitialized) {
            resolve();
          }
        };

        debugSession.adapter.once("Inspector.connected", () => {
          inspectorConnected = true;
          checkDone();
        });

        debugSession.adapter.once("Adapter.initialized", () => {
          adapterInitialized = true;
          checkDone();
        });
      });

      // Now wait for debug session to complete
      await new Promise<void>(resolve => {
        const disposable = vscode.debug.onDidTerminateDebugSession(() => {
          const duration = (performance.now() - startTime).toFixed(1);
          debugSession.sendEvent(new OutputEvent(`✓ Code execution completed in ${duration}ms\n`));
          disposable.dispose();
          resolve();
        });
      });
    }
  } catch (err) {
    if (vscode.debug.activeDebugSession) {
      const duration = (performance.now() - startTime).toFixed(1);
      const errorSession = adapters.get(vscode.debug.activeDebugSession.id);
      errorSession?.sendEvent(
        new OutputEvent(`✕ Error after ${duration}ms: ${err instanceof Error ? err.message : String(err)}\n`),
      );
    }
  }
}

const languageIds = ["javascript", "typescript", "javascriptreact", "typescriptreact"];

class BunCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!document.isUntitled || document.isClosed || document.lineCount === 0) return [];
    if (!languageIds.includes(document.languageId)) {
      return [];
    }

    // Create a range at position 0,0 with zero width
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

    return [
      new vscode.CodeLens(range, {
        title: "eval with bun",
        command: "extension.bun.runUnsavedCode",
        tooltip: "Run this unsaved, scratch file with Bun",
      }),
    ];
  }
}
