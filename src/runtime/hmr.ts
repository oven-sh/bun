import { ByteBuffer } from "peechy/bb";
import * as Schema from "../api/schema";

var runOnce = false;
var clientStartTime = 0;

function formatDuration(duration: number) {
  return Math.round(duration * 100000) / 100;
}

export class Client {
  socket: WebSocket;
  hasWelcomed: boolean = false;
  reconnect: number = 0;
  // Server timestamps are relative to the time the server's HTTP server launched
  // This so we can send timestamps as uint32 instead of 128-bit integers
  epoch: number = 0;

  start() {
    if (runOnce) {
      console.warn(
        "[speedy] Attempted to start HMR client multiple times. This may be a bug."
      );
      return;
    }

    runOnce = true;
    this.connect();
  }

  connect() {
    clientStartTime = performance.now();

    this.socket = new WebSocket("/_api", ["speedy-hmr"]);
    this.socket.binaryType = "arraybuffer";
    this.socket.onclose = this.handleClose;
    this.socket.onopen = this.handleOpen;
    this.socket.onmessage = this.handleMessage;
  }

  // key: module id
  // value: server-timestamp
  builds = new Map<number, number>();

  indexOfModuleId(id: number): number {
    return Module.dependencies.graph.indexOf(id);
  }

  handleBuildFailure(buffer: ByteBuffer, timestamp: number) {
    // 0: ID
    // 1: Timestamp
    const header_data = new Uint32Array(
      buffer._data.buffer,
      buffer._data.byteOffset,
      buffer._data.byteOffset + 8
    );
    const index = this.indexOfModuleId(header_data[0]);
    // Ignore build failures of modules that are not loaded
    if (index === -1) {
      return;
    }

    // Build failed for a module we didn't request?
    const minTimestamp = this.builds.get(index);
    if (!minTimestamp) {
      return;
    }
    const fail = Schema.decodeWebsocketMessageBuildFailure(buffer);
    // TODO: finish this.
    console.error("[speedy] Build failed", fail.module_path);
  }

  verbose = process.env.SPEEDY_HMR_VERBOSE;

  handleBuildSuccess(buffer: ByteBuffer, timestamp: number) {
    // 0: ID
    // 1: Timestamp
    const header_data = new Uint32Array(
      buffer._data.buffer,
      buffer._data.byteOffset,
      buffer._data.byteOffset + 8
    );
    const index = this.indexOfModuleId(header_data[0]);
    // Ignore builds of modules that are not loaded
    if (index === -1) {
      if (this.verbose) {
        console.debug(
          `[speedy] Skipping reload for unknown module id:`,
          header_data[0]
        );
      }

      return;
    }

    // Ignore builds of modules we expect a later version of
    const currentVersion = this.builds.get(header_data[0]) || -Infinity;
    if (currentVersion > header_data[1]) {
      if (this.verbose) {
        console.debug(
          `[speedy] Ignoring module update for "${Module.dependencies.modules[index].url.pathname}" due to timestamp mismatch.\n  Expected: >=`,
          currentVersion,
          `\n   Received:`,
          header_data[1]
        );
      }
      return;
    }

    if (this.verbose) {
      console.debug(
        "[speedy] Preparing to reload",
        Module.dependencies.modules[index].url.pathname
      );
    }

    const build = Schema.decodeWebsocketMessageBuildSuccess(buffer);
    var reload = new HotReload(header_data[0], index, build);
    reload.timings.notify = timestamp - build.from_timestamp;
    reload.run().then(
      ([module, timings]) => {
        console.log(
          `[speedy] Reloaded in ${formatDuration(timings.total)}ms :`,
          module.url.pathname
        );
      },
      (err) => {
        console.error("[speedy] Hot Module Reload failed!", err);
        debugger;
      }
    );
  }

  handleFileChangeNotification(buffer: ByteBuffer, timestamp: number) {
    const notification =
      Schema.decodeWebsocketMessageFileChangeNotification(buffer);
    const index = Module.dependencies.graph.indexOf(notification.id);

    if (index === -1) {
      if (this.verbose) {
        console.debug("[speedy] Unknown module changed, skipping");
      }
      return;
    }

    if ((this.builds.get(notification.id) || -Infinity) > timestamp) {
      console.debug(
        `[speedy] Received update for ${Module.dependencies.modules[index].url.pathname}`
      );
      return;
    }

    if (this.verbose) {
      console.debug(
        `[speedy] Requesting update for ${Module.dependencies.modules[index].url.pathname}`
      );
    }

    this.builds.set(notification.id, timestamp);
    this.buildCommandBuf[0] = Schema.WebsocketCommandKind.build;
    this.buildCommandUArray[0] = timestamp;
    this.buildCommandBuf.set(new Uint8Array(this.buildCommandUArray), 1);
    this.buildCommandUArray[0] = notification.id;
    this.buildCommandBuf.set(new Uint8Array(this.buildCommandUArray), 5);
    this.socket.send(this.buildCommandBuf);
  }
  buildCommandBuf = new Uint8Array(9);
  buildCommandUArray = new Uint32Array(1);

  handleOpen = (event: Event) => {
    globalThis.clearInterval(this.reconnect);
    this.reconnect = 0;
  };

  handleMessage = (event: MessageEvent) => {
    const data = new Uint8Array(event.data);
    const message_header_byte_buffer = new ByteBuffer(data);
    const header = Schema.decodeWebsocketMessage(message_header_byte_buffer);
    const buffer = new ByteBuffer(
      data.subarray(message_header_byte_buffer._index)
    );

    switch (header.kind) {
      case Schema.WebsocketMessageKind.build_fail: {
        this.handleBuildFailure(buffer, header.timestamp);
        break;
      }
      case Schema.WebsocketMessageKind.build_success: {
        this.handleBuildSuccess(buffer, header.timestamp);
        break;
      }
      case Schema.WebsocketMessageKind.file_change_notification: {
        this.handleFileChangeNotification(buffer, header.timestamp);
        break;
      }
      case Schema.WebsocketMessageKind.welcome: {
        const now = performance.now();
        console.log(
          "[speedy] HMR connected in",
          formatDuration(now - clientStartTime),
          "ms"
        );
        clientStartTime = now;
        this.hasWelcomed = true;
        const welcome = Schema.decodeWebsocketMessageWelcome(buffer);
        this.epoch = welcome.epoch;
        if (!this.epoch) {
          console.warn("[speedy] Internal HMR error");
        }
        break;
      }
    }
  };

  handleClose = (event: CloseEvent) => {
    if (this.reconnect !== 0) {
      return;
    }

    this.reconnect = setInterval(this.connect, 500) as any as number;
    console.warn("[speedy] HMR disconnected. Attempting to reconnect.");
  };
}

class HotReload {
  module_id: number = 0;
  module_index: number = 0;
  build: Schema.WebsocketMessageBuildSuccess;
  timings = {
    notify: 0,
    decode: 0,
    import: 0,
    callbacks: 0,
    total: 0,
    start: 0,
  };

  constructor(
    module_id: HotReload["module_id"],
    module_index: HotReload["module_index"],
    build: HotReload["build"]
  ) {
    this.module_id = module_id;
    this.module_index = module_index;
    this.build = build;
  }

  async run(): Promise<[Module, HotReload["timings"]]> {
    const importStart = performance.now();
    let orig_deps = Module.dependencies;
    Module.dependencies = orig_deps.fork(this.module_index);
    var blobURL = null;
    try {
      const blob = new Blob([this.build.bytes], { type: "text/javascript" });
      blobURL = URL.createObjectURL(blob);
      await import(blobURL);
      this.timings.import = performance.now() - importStart;
    } catch (exception) {
      Module.dependencies = orig_deps;
      URL.revokeObjectURL(blobURL);
      throw exception;
    }

    URL.revokeObjectURL(blobURL);

    if (process.env.SPEEDY_HMR_VERBOSE) {
      console.debug(
        "[speedy] Re-imported",
        Module.dependencies.modules[this.module_index].url.pathname,
        "in",
        formatDuration(this.timings.import),
        ". Running callbacks"
      );
    }

    const callbacksStart = performance.now();
    try {
      // ES Modules delay execution until all imports are parsed
      // They execute depth-first
      // If you load N modules and append each module ID to the array, 0 is the *last* module imported.
      // modules.length - 1 is the first.
      // Therefore, to reload all the modules in the correct order, we traverse the graph backwards
      // This only works when the graph is up to date.
      // If the import order changes, we need to regenerate the entire graph
      // Which sounds expensive, until you realize that we are mostly talking about an array that will be typically less than 1024 elements
      // Computers can do that in < 1ms easy!
      for (let i = Module.dependencies.graph_used; i > this.module_index; i--) {
        let handled = !Module.dependencies.modules[i].exports.__hmrDisable;
        if (typeof Module.dependencies.modules[i].dispose === "function") {
          Module.dependencies.modules[i].dispose();
          handled = true;
        }
        if (typeof Module.dependencies.modules[i].accept === "function") {
          Module.dependencies.modules[i].accept();
          handled = true;
        }
        if (!handled) {
          Module.dependencies.modules[i]._load();
        }
      }
    } catch (exception) {
      Module.dependencies = orig_deps;
      throw exception;
    }
    this.timings.callbacks = performance.now() - callbacksStart;

    if (process.env.SPEEDY_HMR_VERBOSE) {
      console.debug(
        "[speedy] Ran callbacks",
        Module.dependencies.modules[this.module_index].url.pathname,
        "in",
        formatDuration(this.timings.callbacks),
        "ms"
      );
    }

    orig_deps = null;
    this.timings.total =
      this.timings.import + this.timings.callbacks + this.build.from_timestamp;
    return Promise.resolve([
      Module.dependencies.modules[this.module_index],
      this.timings,
    ]);
  }
}
var client: Client;
if ("SPEEDY_HMR_CLIENT" in globalThis) {
  console.warn(
    "[speedy] Attempted to load multiple copies of HMR. This may be a bug."
  );
} else if (process.env.SPEEDY_HMR_ENABLED) {
  client = new Client();
  client.start();
  globalThis.SPEEDY_HMR_CLIENT = client;
}

export class Module {
  constructor(id: number, url: URL) {
    // Ensure V8 knows this is a U32
    this.id = id | 0;
    this.url = url;

    if (!Module._dependencies) {
      Module.dependencies = Module._dependencies;
    }

    this.graph_index = Module.dependencies.graph_used++;

    // Grow the dependencies graph
    if (Module.dependencies.graph.length <= this.graph_index) {
      const new_graph = new Uint32Array(Module.dependencies.graph.length * 4);
      new_graph.set(Module.dependencies.graph);
      Module.dependencies.graph = new_graph;

      // In-place grow. This creates a holey array, which is bad, but less bad than pushing potentially 1000 times
      Module.dependencies.modules.length = new_graph.length;
    }

    Module.dependencies.modules[this.graph_index] = this;
    Module.dependencies.graph[this.graph_index] = this.id | 0;
  }
  additional_files = [];

  // When a module updates, we need to re-initialize each dependent, recursively
  // To do so:
  // 1. Track which modules are imported by which *at runtime*
  // 2. When A updates, loop through each dependent of A in insertion order
  // 3. For each old dependent, call .dispose() if exists
  // 3. For each new dependent, call .accept() if exists
  // 4.
  static _dependencies = {
    modules: new Array<Module>(32),
    graph: new Uint32Array(32),
    graph_used: 0,

    fork(offset: number) {
      return {
        modules: Module._dependencies.modules.slice(),
        graph: Module._dependencies.graph.slice(),
        graph_used: offset - 1,
      };
    },
  };
  static dependencies: Module["_dependencies"];
  url: URL;
  _load = function () {};
  id = 0;
  graph_index = 0;
  _exports = {};
  exports = {};
}
