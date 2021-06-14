import { ByteBuffer } from "peechy/bb";
import * as API from "../api/schema";

var runOnce = false;
var clientStartTime = 0;

function formatDuration(duration: number) {
  return Math.round(duration * 1000) / 1000;
}

class HMRClient {
  static client: HMRClient;
  socket: WebSocket;
  hasWelcomed: boolean = false;
  reconnect: number = 0;
  // Server timestamps are relative to the time the server's HTTP server launched
  // This so we can send timestamps as uint32 instead of 128-bit integers
  epoch: number = 0;

  start() {
    if (runOnce) {
      __hmrlog.warn(
        "Attempted to start HMR client multiple times. This may be a bug."
      );
      return;
    }

    runOnce = true;
    this.connect();
  }

  connect() {
    clientStartTime = performance.now();
    const baseURL = new URL(location.origin + "/_api");
    baseURL.protocol = location.protocol === "https" ? "wss" : "ws";
    this.socket = new WebSocket(baseURL.toString(), ["speedy-hmr"]);
    this.socket.binaryType = "arraybuffer";
    this.socket.onclose = this.handleClose;
    this.socket.onerror = this.handleError;
    this.socket.onopen = this.handleOpen;
    this.socket.onmessage = this.handleMessage;
  }

  // key: module id
  // value: server-timestamp
  builds = new Map<number, number>();

  indexOfModuleId(id: number): number {
    return HMRModule.dependencies.graph.indexOf(id);
  }

  static activate(verbose: boolean = false) {
    if (this.client) {
      return;
    }

    this.client = new HMRClient();
    this.client.verbose = verbose;
    this.client.start();
    globalThis["SPEEDY_HMR"] = this.client;
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
    const fail = API.decodeWebsocketMessageBuildFailure(buffer);
    // TODO: finish this.
    __hmrlog.error("Build failed", fail.module_path);
  }

  verbose = false;

  handleError = (error: ErrorEvent) => {
    __hmrlog.error("Websocket error", error.error);
    if (this.reconnect !== 0) {
      return;
    }

    this.reconnect = setInterval(this.connect, 500) as any as number;
  };

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
        __hmrlog.debug(
          `Skipping reload for unknown module id:`,
          header_data[0]
        );
      }

      return;
    }

    // Ignore builds of modules we expect a later version of
    const currentVersion = this.builds.get(header_data[0]) || -Infinity;
    if (currentVersion > header_data[1]) {
      if (this.verbose) {
        __hmrlog.debug(
          `Ignoring outdated update for "${HMRModule.dependencies.modules[index].file_path}".\n  Expected: >=`,
          currentVersion,
          `\n   Received:`,
          header_data[1]
        );
      }
      return;
    }

    if (this.verbose) {
      __hmrlog.debug(
        "Preparing to reload",
        HMRModule.dependencies.modules[index].file_path
      );
    }

    const build = API.decodeWebsocketMessageBuildSuccess(buffer);
    var reload = new HotReload(
      header_data[0],
      index,
      build,
      // These are the bytes!!
      buffer.data.length > buffer._index
        ? buffer.data.subarray(buffer._index)
        : new Uint8Array(0)
    );
    reload.timings.notify = timestamp - build.from_timestamp;
    reload.run().then(
      ([module, timings]) => {
        __hmrlog.log(
          `Reloaded in ${formatDuration(timings.total)}ms :`,
          module.file_path
        );
      },
      (err) => {
        __hmrlog.error("Hot Module Reload failed!", err);
        debugger;
      }
    );
  }

  handleFileChangeNotification(buffer: ByteBuffer, timestamp: number) {
    const notification =
      API.decodeWebsocketMessageFileChangeNotification(buffer);
    const index = HMRModule.dependencies.graph.indexOf(notification.id);

    if (index === -1) {
      if (this.verbose) {
        __hmrlog.debug("Unknown module changed, skipping");
      }
      return;
    }

    if ((this.builds.get(notification.id) || -Infinity) > timestamp) {
      __hmrlog.debug(
        `Received update for ${HMRModule.dependencies.modules[index].file_path}`
      );
      return;
    }

    if (this.verbose) {
      __hmrlog.debug(
        `Requesting update for ${HMRModule.dependencies.modules[index].file_path}`
      );
    }

    this.builds.set(notification.id, timestamp);
    this.buildCommandBuf[0] = API.WebsocketCommandKind.build;
    this.buildCommandUArray[0] = timestamp;
    this.buildCommandBuf.set(this.buildCommandUArrayEight, 1);
    this.buildCommandUArray[0] = notification.id;
    this.buildCommandBuf.set(this.buildCommandUArrayEight, 5);
    this.socket.send(this.buildCommandBuf);
  }
  buildCommandBuf = new Uint8Array(9);
  buildCommandUArray = new Uint32Array(1);
  buildCommandUArrayEight = new Uint8Array(this.buildCommandUArray.buffer);

  handleOpen = (event: Event) => {
    globalThis.clearInterval(this.reconnect);
    this.reconnect = 0;
  };

  handleMessage = (event: MessageEvent) => {
    const data = new Uint8Array(event.data);
    const message_header_byte_buffer = new ByteBuffer(data);
    const header = API.decodeWebsocketMessage(message_header_byte_buffer);
    const buffer = new ByteBuffer(
      data.subarray(message_header_byte_buffer._index)
    );

    switch (header.kind) {
      case API.WebsocketMessageKind.build_fail: {
        this.handleBuildFailure(buffer, header.timestamp);
        break;
      }
      case API.WebsocketMessageKind.build_success: {
        this.handleBuildSuccess(buffer, header.timestamp);
        break;
      }
      case API.WebsocketMessageKind.file_change_notification: {
        this.handleFileChangeNotification(buffer, header.timestamp);
        break;
      }
      case API.WebsocketMessageKind.welcome: {
        const now = performance.now();
        __hmrlog.log(
          "HMR connected in",
          formatDuration(now - clientStartTime),
          "ms"
        );
        clientStartTime = now;
        this.hasWelcomed = true;
        const welcome = API.decodeWebsocketMessageWelcome(buffer);
        this.epoch = welcome.epoch;
        if (!this.epoch) {
          __hmrlog.warn("Internal HMR error");
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
    __hmrlog.warn("HMR disconnected. Attempting to reconnect.");
  };
}

export { HMRClient as __HMRClient };

class HotReload {
  module_id: number = 0;
  module_index: number = 0;
  build: API.WebsocketMessageBuildSuccess;
  timings = {
    notify: 0,
    decode: 0,
    import: 0,
    callbacks: 0,
    total: 0,
    start: 0,
  };
  static VERBOSE = false;
  bytes: Uint8Array;

  constructor(
    module_id: HotReload["module_id"],
    module_index: HotReload["module_index"],
    build: HotReload["build"],
    bytes: Uint8Array
  ) {
    this.module_id = module_id;
    this.module_index = module_index;
    this.build = build;
    this.bytes = bytes;
  }

  async run(): Promise<[HMRModule, HotReload["timings"]]> {
    const importStart = performance.now();
    let orig_deps = HMRModule.dependencies;
    // we must preserve the updater since that holds references to the real exports.
    // this is a fundamental limitation of using esmodules for HMR.
    // we cannot export new modules. we can only mutate existing ones.

    HMRModule.dependencies = orig_deps.fork(this.module_index);
    var blobURL = null;
    try {
      const blob = new Blob([this.bytes], { type: "text/javascript" });
      blobURL = URL.createObjectURL(blob);
      await import(blobURL);
      this.timings.import = performance.now() - importStart;
    } catch (exception) {
      HMRModule.dependencies = orig_deps;
      URL.revokeObjectURL(blobURL);
      // Ensure we don't keep the bytes around longer than necessary
      this.bytes = null;
      throw exception;
    }

    URL.revokeObjectURL(blobURL);
    // Ensure we don't keep the bytes around longer than necessary
    this.bytes = null;

    if (HotReload.VERBOSE) {
      __hmrlog.debug(
        "Re-imported",
        HMRModule.dependencies.modules[this.module_index].file_path,
        "in",
        formatDuration(this.timings.import),
        ". Running callbacks"
      );
    }

    const callbacksStart = performance.now();
    try {
      // ES Modules delay execution until all imports are parsed
      // They execute depth-first
      // If you load N modules and append each module ID to the array, 0 is the *last* unique module imported.
      // modules.length - 1 is the first.
      // Therefore, to reload all the modules in the correct order, we traverse the graph backwards
      // This only works when the graph is up to date.
      // If the import order changes, we need to regenerate the entire graph
      // Which sounds expensive, until you realize that we are mostly talking about an array that will be typically less than 1024 elements
      // Computers can create an array of < 1024 pointer-sized elements in < 1ms easy!
      for (
        let i = HMRModule.dependencies.graph_used;
        i > this.module_index;
        i--
      ) {
        let handled = !HMRModule.dependencies.modules[i].exports.__hmrDisable;
        if (typeof HMRModule.dependencies.modules[i].dispose === "function") {
          HMRModule.dependencies.modules[i].dispose();
          handled = true;
        }
        if (typeof HMRModule.dependencies.modules[i].accept === "function") {
          HMRModule.dependencies.modules[i].accept();
          handled = true;
        }
        if (!handled) {
          HMRModule.dependencies.modules[i]._load();
        }
      }
    } catch (exception) {
      HMRModule.dependencies = orig_deps;
      throw exception;
    }
    this.timings.callbacks = performance.now() - callbacksStart;

    if (HotReload.VERBOSE) {
      __hmrlog.debug(
        "Ran callbacks",
        HMRModule.dependencies.modules[this.module_index].file_path,
        "in",
        formatDuration(this.timings.callbacks),
        "ms"
      );
    }

    orig_deps = null;
    this.timings.total =
      this.timings.import + this.timings.callbacks + this.build.from_timestamp;
    return Promise.resolve([
      HMRModule.dependencies.modules[this.module_index],
      this.timings,
    ]);
  }
}

class HMRModule {
  constructor(id: number, file_path: string) {
    this.id = id;
    this.file_path = file_path;

    if (!HMRModule.dependencies) {
      HMRModule.dependencies = HMRModule._dependencies;
    }

    this.graph_index = HMRModule.dependencies.graph_used++;

    // Grow the dependencies graph
    if (HMRModule.dependencies.graph.length <= this.graph_index) {
      const new_graph = new Uint32Array(
        HMRModule.dependencies.graph.length * 4
      );
      new_graph.set(HMRModule.dependencies.graph);
      HMRModule.dependencies.graph = new_graph;

      // In-place grow. This creates a holey array, which is bad, but less bad than pushing potentially 1000 times
      HMRModule.dependencies.modules.length = new_graph.length;
    }

    if (
      typeof HMRModule.dependencies.modules[this.graph_index] === "object" &&
      HMRModule.dependencies.modules[this.graph_index] instanceof HMRModule &&
      HMRModule.dependencies.modules[this.graph_index].id === id &&
      typeof HMRModule.dependencies.modules[this.graph_index]._update ===
        "function"
    ) {
      this.additional_updaters.push(
        HMRModule.dependencies.modules[this.graph_index]._update
      );
    }

    HMRModule.dependencies.modules[this.graph_index] = this;
    HMRModule.dependencies.graph[this.graph_index] = this.id;
  }

  additional_files = [];
  additional_updaters = [];
  _update: (exports: Object) => void;
  update() {
    for (let update of this.additional_updaters) {
      update(this.exports);
    }

    this._update(this.exports);
  }

  static _dependencies = {
    modules: new Array<HMRModule>(32),
    graph: new Uint32Array(32),
    graph_used: 0,

    fork(offset: number) {
      return {
        modules: HMRModule._dependencies.modules.slice(),
        graph: HMRModule._dependencies.graph.slice(),
        graph_used: offset - 1,
      };
    },
  };

  exportAll(object: Object) {
    // object[alias] must be a function
    for (let alias in object) {
      this._exports[alias] = object[alias];
      Object.defineProperty(this.exports, alias, {
        get: this._exports[alias],
        configurable: true,
        enumerable: true,
      });
    }
  }

  static dependencies: HMRModule["_dependencies"];
  file_path: string;
  _load = function () {};
  id = 0;
  graph_index = 0;
  _exports = {};
  exports = {};
}

var __hmrlog = {
  debug(...args) {
    console.debug("[speedy]", ...args);
  },
  error(...args) {
    console.error("[speedy]", ...args);
  },
  log(...args) {
    console.log("[speedy]", ...args);
  },
  warn(...args) {
    console.warn("[speedy]", ...args);
  },
};

export { HMRModule as __HMRModule };
