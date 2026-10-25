import { afterAll, beforeEach, describe, expect, mock, test, type Mock } from "bun:test";
import { MockRelativePattern, MockUri } from "./vscode-types.mock";
import "./vscode.mock";
import {
  fireConfigurationChange,
  getOutputLines,
  makeWorkspaceFolder,
  openTextDocument,
  resetVscodeMock,
  setConfiguration,
  vscodeMockState,
  type MockFindFiles,
  type MockTextDocumentLike,
} from "./vscode.mock";

const State = { Stopped: 1, Running: 2, Starting: 3 };

class FakeLanguageClient {
  static instances: FakeLanguageClient[] = [];
  started = 0;
  stopped = 0;
  state = State.Stopped;
  errors: { message: string; showNotification: unknown }[] = [];

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly serverOptions: Record<string, any>,
    public readonly clientOptions: Record<string, any>,
  ) {
    FakeLanguageClient.instances.push(this);
  }

  async start(): Promise<void> {
    this.started++;
    this.state = State.Running;
  }

  async stop(): Promise<void> {
    this.stopped++;
    this.state = State.Stopped;
  }

  error(message: string, _data?: unknown, showNotification?: unknown): void {
    this.errors.push({ message, showNotification });
  }
}

mock.module("vscode-languageclient/node", () => ({
  LanguageClient: FakeLanguageClient,
  State,
  TransportKind: { stdio: 0, ipc: 1, pipe: 2, socket: 3 },
  CloseAction: { DoNotRestart: 1, Restart: 2 },
  ErrorAction: { Continue: 1, Shutdown: 2 },
  RevealOutputChannelOn: { Debug: 0, Info: 1, Warn: 2, Error: 3, Never: 4 },
}));

type LspModule = typeof import("../../lsp");
type ServerSpec = import("../../lsp").ServerSpec;
type ClientHooks = import("../../lsp").ClientHooks;

// Each test loads its own copy of the module so `wanted` / `failed` / the running client
// never leak between tests.
let moduleInstance = 0;
async function loadLsp(): Promise<LspModule> {
  moduleInstance++;
  return (await import(`../../lsp?instance=${moduleInstance}`)) as LspModule;
}

class FakeClient {
  started = 0;
  stopped = 0;
  state = State.Stopped;

  constructor(
    public readonly spec: ServerSpec,
    public readonly hooks: ClientHooks,
    private readonly startError?: () => Error | undefined,
    private readonly exitDuringStart = false,
  ) {}

  async start(): Promise<void> {
    this.started++;
    const error = this.startError?.();
    if (error) throw error;
    if (this.exitDuringStart) {
      // Like vscode-languageclient: errorHandler.closed fires from the event loop while Starting.
      await new Promise<void>(resolve => setImmediate(resolve));
      this.state = State.Stopped;
      this.hooks.onClosed();
      return;
    }
    this.state = State.Running;
  }

  async stop(): Promise<void> {
    this.stopped++;
    this.state = State.Stopped;
  }
}

type RegisterContext = Parameters<LspModule["registerLanguageServer"]>[0];

interface HarnessOptions {
  startError?: () => Error | undefined;
  exitDuringStart?: boolean;
  // The installed bun may be older than MIN_BUN_VERSION, so every test injects the probe result.
  version?: string | (() => Promise<string>);
}

function makeHarness({ startError, exitDuringStart = false, version = "1.4.5" }: HarnessOptions = {}) {
  const clients: FakeClient[] = [];
  const subscriptions: { dispose(): void }[] = [];
  // lsp.ts only touches `subscriptions`; the cast lives here so each test does not repeat it.
  const context = { subscriptions } as unknown as RegisterContext;
  const createClient = mock((spec: ServerSpec, hooks: ClientHooks) => {
    const client = new FakeClient(spec, hooks, startError, exitDuringStart);
    clients.push(client);
    return client;
  });
  const probeVersion = mock(async (_runtime: string) => (typeof version === "string" ? version : await version()));
  return { clients, context, subscriptions, createClient, probeVersion };
}

const WITH_MARKER = "/ws/with-marker";
const OTHER_WITH_MARKER = "/ws/other-with-marker";
const NO_MARKER = "/ws/no-marker";
const NODE_MODULES_EXCLUDE = "**/node_modules/**";
const foldersWithMarker = new Set([WITH_MARKER, OTHER_WITH_MARKER]);

function patternBase(include: string | MockRelativePattern): string {
  return typeof include === "string" ? include : include.baseUri.fsPath;
}

function doc(path: string, languageId = "typescript", scheme = "file"): MockTextDocumentLike {
  const uri = scheme === "file" ? MockUri.file(path) : new MockUri(scheme, "", path, "", "", path);
  return { uri, languageId };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met before the deadline");
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

async function open(document: MockTextDocumentLike): Promise<void> {
  await openTextDocument(document);
  await settle();
}

describe("registerLanguageServer", () => {
  let findFiles: Mock<MockFindFiles>;

  beforeEach(() => {
    resetVscodeMock();
    FakeLanguageClient.instances.length = 0;
    vscodeMockState.workspaceFolders = [
      makeWorkspaceFolder(WITH_MARKER),
      makeWorkspaceFolder(NO_MARKER),
      makeWorkspaceFolder(OTHER_WITH_MARKER),
    ];
    findFiles = mock<MockFindFiles>(async include => {
      const base = patternBase(include);
      return foldersWithMarker.has(base) ? [MockUri.file(`${base}/bunfig.toml`)] : [];
    });
    vscodeMockState.findFiles = findFiles;
  });

  afterAll(() => {
    resetVscodeMock();
  });

  test("exports the marker glob and the supported languages", async () => {
    const lsp = await loadLsp();
    expect(lsp.MARKER_GLOB).toContain("bunfig.toml");
    expect(lsp.MARKER_GLOB).toContain("bun.lock");
    expect(lsp.MARKER_GLOB).toContain("bun.lockb");
    expect(lsp.LSP_LANGUAGE_IDS).toContain("typescript");
    expect(lsp.LSP_LANGUAGE_IDS).toContain("javascript");
    expect(lsp.LSP_LANGUAGE_IDS).toContain("json");
  });

  test("does not start for a document that is not a file", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`, "typescript", "untitled"));
    await open(doc(`${WITH_MARKER}/index.ts`, "typescript", "vscode-userdata"));

    expect(clients).toHaveLength(0);
  });

  test("does not start for an unsupported language", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/main.rs`, "rust"));
    await open(doc(`${WITH_MARKER}/notes.txt`, "plaintext"));

    expect(clients).toHaveLength(0);
  });

  test("does not start for a folder without bunfig.toml, bun.lock or bun.lockb", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${NO_MARKER}/index.ts`));
    await open(doc("/outside/any/folder/index.ts"));

    expect(clients).toHaveLength(0);
  });

  test("does not start when bun.lsp.enable is false", async () => {
    setConfiguration("bun.lsp.enable", false);
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));

    expect(clients).toHaveLength(0);
  });

  test("starts for already-open documents when bun.lsp.enable turns on", async () => {
    setConfiguration("bun.lsp.enable", false);
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    expect(clients).toHaveLength(0);

    setConfiguration("bun.lsp.enable", true);
    await fireConfigurationChange(["bun.lsp.enable"]);
    await waitFor(() => clients.length === 1);
    await settle();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(clients[0].spec.args).toEqual(["fmt", "--no-script", "--lsp"]);
    expect(clients[0].started).toBe(1);
  });

  test("starts exactly one client for the first qualifying document", async () => {
    const lsp = await loadLsp();
    const { clients, context, subscriptions, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });
    expect(subscriptions).toHaveLength(2);

    await open(doc(`${WITH_MARKER}/index.ts`));

    expect(clients).toHaveLength(1);
    expect(clients[0].spec.command).toBe("bun");
    expect(clients[0].spec.args).toEqual(["fmt", "--no-script", "--lsp"]);
    expect(clients[0].started).toBe(1);
    expect(vscodeMockState.messages).toHaveLength(0);

    await open(doc(`${WITH_MARKER}/other.tsx`, "typescriptreact"));
    await open(doc(`${OTHER_WITH_MARKER}/package.json`, "json"));

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(1);
    expect(clients[0].started).toBe(1);
  });

  test("looks for the marker once per workspace folder, skipping node_modules", async () => {
    const lsp = await loadLsp();
    const { context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    await open(doc(`${WITH_MARKER}/other.ts`));

    expect(findFiles).toHaveBeenCalledTimes(1);
    const [include, exclude, maxResults] = findFiles.mock.calls[0];
    expect(include).toBeInstanceOf(MockRelativePattern);
    expect((include as MockRelativePattern).pattern).toBe(lsp.MARKER_GLOB);
    expect(patternBase(include)).toBe(WITH_MARKER);
    expect(exclude).toBe(NODE_MODULES_EXCLUDE);
    expect(maxResults).toBe(1);

    await open(doc(`${NO_MARKER}/index.ts`));
    await open(doc(`${NO_MARKER}/other.ts`));
    await open(doc(`${OTHER_WITH_MARKER}/index.ts`));

    expect(findFiles).toHaveBeenCalledTimes(3);
    expect(findFiles.mock.calls.map(([include]) => patternBase(include))).toEqual([
      WITH_MARKER,
      NO_MARKER,
      OTHER_WITH_MARKER,
    ]);
  });

  test("uses the first workspace folder as cwd, not the folder of the triggering document", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${OTHER_WITH_MARKER}/index.ts`));

    expect(clients).toHaveLength(1);
    expect(clients[0].spec.cwd).toBe(WITH_MARKER);
  });

  test("uses the trimmed bun.runtime setting as the command", async () => {
    setConfiguration("bun.runtime", "  /opt/bun/bin/bun  ");
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.js`, "javascript"));

    expect(clients).toHaveLength(1);
    expect(clients[0].spec.command).toBe("/opt/bun/bin/bun");
    expect(clients[0].spec.args).toEqual(["fmt", "--no-script", "--lsp"]);
  });

  test("starts for a qualifying document that is already open at registration", async () => {
    vscodeMockState.textDocuments.push(doc(`${NO_MARKER}/index.ts`), doc(`${WITH_MARKER}/index.ts`));
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });
    await waitFor(() => clients.length === 1);
    await settle();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(clients[0].started).toBe(1);
  });

  test("logs one line and does not retry when the client fails to start", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness({
      startError: () => new Error("spawn bun ENOENT"),
    });
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));

    expect(clients).toHaveLength(1);
    expect(clients[0].started).toBe(1);
    const lines = getOutputLines("Bun");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("spawn bun ENOENT");
    expect(vscodeMockState.messages).toHaveLength(0);

    await open(doc(`${WITH_MARKER}/second.ts`));
    await open(doc(`${OTHER_WITH_MARKER}/third.ts`));

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(clients[0].started).toBe(1);
    expect(getOutputLines("Bun")).toHaveLength(1);
  });

  test("treats a client that is not running after start() as a failed start", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness({ exitDuringStart: true });
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    await open(doc(`${WITH_MARKER}/second.ts`));

    expect(clients).toHaveLength(1);
    expect(clients[0].started).toBe(1);
    const lines = getOutputLines("Bun");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("exited during startup");
    expect(vscodeMockState.messages).toHaveLength(0);
  });

  test("starts again for the next qualifying document after the server exits", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    expect(clients).toHaveLength(1);
    expect(clients[0].state).toBe(State.Running);

    clients[0].state = State.Stopped;
    clients[0].hooks.onClosed();
    await settle();

    // Nothing spawns until another supported file is opened.
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(getOutputLines("Bun")).toEqual([
      "The Bun language server exited; it starts again the next time a supported file is opened",
    ]);
    expect(vscodeMockState.messages).toHaveLength(0);

    // A second close report for the same client is ignored.
    clients[0].hooks.onClosed();
    expect(getOutputLines("Bun")).toHaveLength(1);

    await open(doc(`${WITH_MARKER}/second.ts`));

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(clients).toHaveLength(2);
    expect(clients[0].stopped).toBe(0);
    expect(clients[1].spec.args).toEqual(["fmt", "--no-script", "--lsp"]);
    expect(clients[1].started).toBe(1);
    expect(clients[1].state).toBe(State.Running);
    expect(getOutputLines("Bun")).toHaveLength(1);

    await open(doc(`${OTHER_WITH_MARKER}/third.ts`));
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  test("a close during startup keeps the failed-start path and does not start again", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness({ exitDuringStart: true });
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    await open(doc(`${WITH_MARKER}/second.ts`));

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(1);
    const lines = getOutputLines("Bun");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("Failed to start the Bun language server: ");
    expect(lines[0]).toContain("exited during startup");
    expect(vscodeMockState.messages).toHaveLength(0);
  });

  test("restarts with the new command when bun.runtime changes and a document wanted it", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    expect(clients).toHaveLength(1);

    setConfiguration("bun.runtime", "/opt/bun");
    await fireConfigurationChange(["bun.runtime"]);
    await settle();

    expect(clients[0].stopped).toBe(1);
    expect(clients).toHaveLength(2);
    expect(clients[1].spec.command).toBe("/opt/bun");
    expect(clients[1].spec.args).toEqual(["fmt", "--no-script", "--lsp"]);
    expect(clients[1].started).toBe(1);
  });

  test("retries after a failed start once bun.runtime changes", async () => {
    let fail = true;
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness({
      startError: () => (fail ? new Error("spawn bun ENOENT") : undefined),
    });
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    expect(clients).toHaveLength(1);
    expect(getOutputLines("Bun")).toHaveLength(1);

    fail = false;
    setConfiguration("bun.runtime", "/opt/bun");
    await fireConfigurationChange(["bun.runtime"]);
    await settle();

    expect(clients).toHaveLength(2);
    expect(clients[1].spec.command).toBe("/opt/bun");
    expect(clients[1].started).toBe(1);
    expect(getOutputLines("Bun")).toHaveLength(1);
  });

  test("does not start on a bun.runtime change when no document wanted the server", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${NO_MARKER}/index.ts`));
    setConfiguration("bun.runtime", "/opt/bun");
    await fireConfigurationChange(["bun.runtime"]);
    await settle();

    expect(clients).toHaveLength(0);
  });

  test("ignores configuration changes that do not affect bun.runtime", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    await fireConfigurationChange(["bun.test.filePattern"]);
    await settle();

    expect(clients).toHaveLength(1);
    expect(clients[0].stopped).toBe(0);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  test("constructs the real LanguageClient over stdio without a --stdio flag by default", async () => {
    setConfiguration("bun.lint.enable", false);
    setConfiguration("bun.lint.run", "onSave");
    setConfiguration("bun.format.enable", true);
    // Other bun.* keys must neither reach initializationOptions nor be synced.
    setConfiguration("bun.runtime", "bun");
    setConfiguration("bun.lint.rules", { "no-debugger": "error" });
    setConfiguration("bun.format.indentWidth", 4);
    const lsp = await loadLsp();
    const { context, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));

    expect(FakeLanguageClient.instances).toHaveLength(1);
    const [client] = FakeLanguageClient.instances;
    expect(client.id).toBe("bun");
    expect(client.name).toBe("Bun");
    expect(client.started).toBe(1);
    expect(client.serverOptions.command).toBe("bun");
    expect(client.serverOptions.args).toEqual(["fmt", "--no-script", "--lsp"]);
    expect(client.serverOptions.transport).toBeUndefined();
    expect(client.serverOptions.options.cwd).toBe(WITH_MARKER);
    expect(client.clientOptions.documentSelector).toContainEqual({ scheme: "file", language: "typescript" });
    expect(client.clientOptions.initializationOptions).toEqual({
      lint: { enable: false, run: "onSave" },
      format: { enable: true },
    });
    expect(client.clientOptions.synchronize.configurationSection).toEqual(["bun.lint", "bun.format"]);
    expect(client.clientOptions.outputChannel.name).toBe("Bun");
    expect(client.clientOptions.initializationFailedHandler(new Error("boom"))).toBe(false);
    expect(client.clientOptions.revealOutputChannelOn).toBe(4);
    expect(client.clientOptions.errorHandler.error(new Error("boom"), undefined, 1)).toMatchObject({
      action: 1,
      handled: true,
    });
    client.error("couldn't create connection to server.", new Error("boom"), "force");
    expect(client.errors).toEqual([{ message: "couldn't create connection to server.", showNotification: false }]);
    expect(vscodeMockState.messages).toHaveLength(0);
    expect(getOutputLines("Bun")).toHaveLength(0);

    // errorHandler.closed is what vscode-languageclient calls after a Running server exits.
    expect(client.clientOptions.errorHandler.closed()).toMatchObject({ action: 1, handled: true });
    const lines = getOutputLines("Bun");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("exited");
    expect(vscodeMockState.messages).toHaveLength(0);

    await open(doc(`${WITH_MARKER}/second.ts`));
    expect(FakeLanguageClient.instances).toHaveLength(2);
    expect(FakeLanguageClient.instances[1].started).toBe(1);
    expect(getOutputLines("Bun")).toHaveLength(1);
  });

  test("sends the default lint and format settings when none are configured", async () => {
    const lsp = await loadLsp();
    const { context, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));

    expect(FakeLanguageClient.instances).toHaveLength(1);
    const [client] = FakeLanguageClient.instances;
    expect(client.started).toBe(1);
    expect(client.clientOptions.initializationOptions).toEqual({
      lint: { enable: true, run: "onType" },
      format: { enable: true },
    });
    expect(client.clientOptions.synchronize.configurationSection).toEqual(["bun.lint", "bun.format"]);
  });
});

describe("stopLanguageServer", () => {
  beforeEach(() => {
    resetVscodeMock();
    FakeLanguageClient.instances.length = 0;
    vscodeMockState.workspaceFolders = [makeWorkspaceFolder(WITH_MARKER)];
    vscodeMockState.findFiles = async include => [MockUri.file(`${patternBase(include)}/bun.lock`)];
  });

  afterAll(() => {
    resetVscodeMock();
  });

  test("is a no-op when no client is running", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await expect(lsp.stopLanguageServer()).resolves.toBeUndefined();
    expect(clients).toHaveLength(0);
  });

  test("stops the running client once", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    expect(clients).toHaveLength(1);

    await lsp.stopLanguageServer();
    expect(clients[0].stopped).toBe(1);

    await lsp.stopLanguageServer();
    expect(clients[0].stopped).toBe(1);
  });

  test("a close reported after stopLanguageServer logs nothing", async () => {
    const lsp = await loadLsp();
    const { clients, context, createClient, probeVersion } = makeHarness();
    lsp.registerLanguageServer(context, { createClient, probeVersion });

    await open(doc(`${WITH_MARKER}/index.ts`));
    expect(clients).toHaveLength(1);

    await lsp.stopLanguageServer();
    expect(clients[0].stopped).toBe(1);

    clients[0].hooks.onClosed();
    await settle();

    expect(getOutputLines("Bun")).toHaveLength(0);
    expect(vscodeMockState.messages).toHaveLength(0);
  });
});
