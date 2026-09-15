import { DebugSession } from "@vscode/debugadapter";
import { tmpdir } from "node:os";
import * as path from "node:path";
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
    injectDebugTerminal2().then(context.subscriptions.push);
  }
}

function runFileCommand(resource?: vscode.Uri): void {
  const file = resource ?? vscode.window.activeTextEditor?.document.uri;
  if (file) launch(RUN_CONFIGURATION, file, file.fsPath);
}

function debugFileCommand(resource?: vscode.Uri): void {
  const file = resource ?? vscode.window.activeTextEditor?.document.uri;
  if (file) launch(DEBUG_CONFIGURATION, file, file.fsPath);
}

// Debugs a script of the package.json shown in the active editor (the hover
// link and the code lens in package.json files call this).
export function debugCommand(script: string): void {
  const packageJson = vscode.window.activeTextEditor?.document.uri;
  if (packageJson) launch(DEBUG_CONFIGURATION, packageJson, script);
}

// `document` is the file to run, or the package.json that holds the script.
// The configurations above set cwd to `${workspaceFolder}`, which VS Code
// resolves only against the folder passed here, or the single folder of a
// single-root window. With no such folder (multi-root window, or no folder at
// all) the cwd is the document's own directory, as js-debug does for a file
// without a folder. resolveDebugConfiguration below fills in `runtime`,
// scoped to the same folder.
function launch(configuration: vscode.DebugConfiguration, document: vscode.Uri, program: string): void {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = vscode.workspace.getWorkspaceFolder(document) ?? (folders.length === 1 ? folders[0] : undefined);
  vscode.debug.startDebugging(folder, {
    ...configuration,
    program,
    cwd: folder?.uri.fsPath ?? path.dirname(document.fsPath),
  });
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
  const jsDebugExt =
    vscode.extensions.getExtension("ms-vscode.js-debug-nightly") ||
    vscode.extensions.getExtension("ms-vscode.js-debug");
  if (!jsDebugExt) {
    return vscode.window.onDidOpenTerminal(injectDebugTerminal);
  }

  await jsDebugExt.activate();
  const jsDebug: import("@vscode/js-debug").IExports = jsDebugExt.exports;
  if (!jsDebug) {
    return vscode.window.onDidOpenTerminal(injectDebugTerminal);
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
    const { request, url, __untitledName, localRoot, remoteRoot } = configuration;

    if (request === "attach") {
      for (const [adapterUrl, adapter] of adapters) {
        if (adapterUrl === url) {
          return new vscode.DebugAdapterInlineImplementation(adapter);
        }
      }
    }

    const adapter = new FileDebugSession(session.id, __untitledName, {
      localRoot,
      remoteRoot,
    });
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

interface PathMapping {
  localRoot?: string;
  remoteRoot?: string;
}

class FileDebugSession extends DebugSession {
  // If these classes are moved/published, we should make sure
  // we remove these non-null assertions so consumers of
  // this lib are not running into these hard
  adapter!: WebSocketDebugAdapter;
  sessionId?: string;
  untitledDocPath?: string;
  bunEvalPath?: string;
  localRoot?: string;
  remoteRoot?: string;
  #isWindowsRemote = false;

  constructor(sessionId?: string, untitledDocPath?: string, mapping?: PathMapping) {
    super();
    this.sessionId = sessionId;
    this.untitledDocPath = untitledDocPath;

    if (mapping) {
      this.localRoot = mapping.localRoot;
      this.remoteRoot = mapping.remoteRoot;
      if (typeof mapping.remoteRoot === "string") {
        this.#isWindowsRemote = mapping.remoteRoot.includes("\\");
      }
    }

    if (untitledDocPath) {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? process.cwd();
      this.bunEvalPath = join(cwd, "[eval]");
    }
  }

  mapRemoteToLocal(p: string | undefined): string | undefined {
    if (!p || !this.remoteRoot || !this.localRoot) return p;
    const remoteModule = this.#isWindowsRemote ? path.win32 : path.posix;
    let remoteRoot = remoteModule.normalize(this.remoteRoot);
    if (!remoteRoot.endsWith(remoteModule.sep)) remoteRoot += remoteModule.sep;
    let target = remoteModule.normalize(p);
    const starts = this.#isWindowsRemote
      ? target.toLowerCase().startsWith(remoteRoot.toLowerCase())
      : target.startsWith(remoteRoot);
    if (starts) {
      const rel = target.slice(remoteRoot.length);
      const localRel = rel.split(remoteModule.sep).join(path.sep);
      return path.join(this.localRoot, localRel);
    }
    return p;
  }

  mapLocalToRemote(p: string | undefined): string | undefined {
    if (!p || !this.remoteRoot || !this.localRoot) return p;
    let localRoot = path.normalize(this.localRoot);
    if (!localRoot.endsWith(path.sep)) localRoot += path.sep;
    let localPath = path.normalize(p);
    if (localPath.startsWith(localRoot)) {
      const rel = localPath.slice(localRoot.length);
      const remoteModule = this.#isWindowsRemote ? path.win32 : path.posix;
      const remoteRel = rel.split(path.sep).join(remoteModule.sep);
      return remoteModule.join(this.remoteRoot, remoteRel);
    }
    return p;
  }

  async initialize() {
    const uniqueId = this.sessionId ?? getRandomId();
    const url =
      process.platform === "win32"
        ? `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`
        : `ws+unix://${tmpdir()}/${uniqueId}.sock`;

    const { untitledDocPath, bunEvalPath } = this;
    this.adapter = new WebSocketDebugAdapter(url, untitledDocPath, bunEvalPath);

    if (untitledDocPath) {
      this.adapter.on("Adapter.response", (response: DebugProtocolResponse) => {
        if (response.body?.source?.path) {
          if (response.body.source.path === bunEvalPath) {
            response.body.source.path = untitledDocPath;
          } else {
            response.body.source.path = this.mapRemoteToLocal(response.body.source.path);
          }
        }
        if (Array.isArray(response.body?.breakpoints)) {
          for (const bp of response.body.breakpoints) {
            if (bp.source?.path === bunEvalPath) {
              bp.source.path = untitledDocPath;
              bp.verified = true;
            } else if (bp.source?.path) {
              bp.source.path = this.mapRemoteToLocal(bp.source.path);
            }
          }
        }
        this.sendResponse(response);
      });

      this.adapter.on("Adapter.event", (event: DebugProtocolEvent) => {
        if (event.body?.source?.path) {
          if (event.body.source.path === bunEvalPath) {
            event.body.source.path = untitledDocPath;
          } else {
            event.body.source.path = this.mapRemoteToLocal(event.body.source.path);
          }
        }
        this.sendEvent(event);
      });
    } else {
      this.adapter.on("Adapter.response", (response: DebugProtocolResponse) => {
        if (response.body?.source?.path) {
          response.body.source.path = this.mapRemoteToLocal(response.body.source.path);
        }
        if (Array.isArray(response.body?.breakpoints)) {
          for (const bp of response.body.breakpoints) {
            if (bp.source?.path) {
              bp.source.path = this.mapRemoteToLocal(bp.source.path);
            }
          }
        }
        this.sendResponse(response);
      });
      this.adapter.on("Adapter.event", (event: DebugProtocolEvent) => {
        if (event.body?.source?.path) {
          event.body.source.path = this.mapRemoteToLocal(event.body.source.path);
        }
        this.sendEvent(event);
      });
    }

    this.adapter.on("Adapter.reverseRequest", ({ command, arguments: args }) =>
      this.sendRequest(command, args, 5000, () => {}),
    );

    adapters.set(url, this);
  }

  handleMessage(message: DAP.Event | DAP.Request | DAP.Response): void {
    const { type } = message;

    if (type === "request") {
      const { untitledDocPath, bunEvalPath } = this;
      const { command } = message;
      if (command === "setBreakpoints" || command === "breakpointLocations") {
        const args = message.arguments as any;
        if (untitledDocPath && args.source?.path === untitledDocPath) {
          args.source.path = bunEvalPath;
        } else if (args.source?.path) {
          args.source.path = this.mapLocalToRemote(args.source.path);
        }
      } else if (command === "source" && message.arguments?.source?.path) {
        message.arguments.source.path = this.mapLocalToRemote(message.arguments.source.path);
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
    super(undefined, undefined);
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

function getRuntime(scope?: vscode.ConfigurationScope): string {
  const value = getConfig<string>("runtime", scope);
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return "bun";
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
