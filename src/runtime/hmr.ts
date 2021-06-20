import { ByteBuffer } from "peechy/bb";
import * as API from "../api/schema";

var runOnce = false;
var clientStartTime = 0;

function formatDuration(duration: number) {
  return Math.round(duration * 1000) / 1000;
}

type HTMLStylableElement = HTMLLinkElement | HTMLStyleElement;
type CSSHMRInsertionPoint = {
  id: number;
  node?: HTMLStylableElement;
  file: string;
  bundle_id: number;
  sheet: CSSStyleSheet;
};

enum CSSUpdateMethod {
  // CSS OM allows synchronous style updates
  cssObjectModel,
  // Blob URLs allow us to skip converting to JavaScript strings
  // However, they run asynchronously. Frequent updates cause FOUC
  blobURL,
}

// How this works
// We keep
export class CSSLoader {
  hmr: HMRClient;
  private static cssLoadId: CSSHMRInsertionPoint = {
    id: 0,
    bundle_id: 0,
    node: null,
    file: "",
    sheet: null,
  };

  updateMethod: CSSUpdateMethod;
  decoder: TextDecoder;

  constructor() {
    if ("replaceSync" in CSSStyleSheet.prototype) {
      this.updateMethod = CSSUpdateMethod.cssObjectModel;
    } else {
      this.updateMethod = CSSUpdateMethod.blobURL;
    }
  }

  // This is a separate function because calling a small function 2000 times is more likely to cause it to be JIT'd
  // We want it to be JIT'd
  // It's possible that returning null may be a de-opt though.
  private findMatchingSupportsRule(
    rule: CSSSupportsRule,
    id: number,
    sheet: CSSStyleSheet
  ): CSSHMRInsertionPoint | null {
    switch (rule.type) {
      // 12 is result.SUPPORTS_RULE
      case 12: {
        if (!rule.conditionText.startsWith("(hmr-wid:")) {
          return null;
        }

        const startIndex = "hmr-wid:".length + 1;
        const endIDRegion = rule.conditionText.indexOf(")", startIndex);
        if (endIDRegion === -1) return null;

        const int = parseInt(
          rule.conditionText.substring(startIndex, endIDRegion),
          10
        );

        if (int !== id) {
          return null;
        }

        let startFileRegion = rule.conditionText.indexOf(
          '(hmr-file:"',
          endIDRegion
        );
        if (startFileRegion === -1) return null;
        startFileRegion += '(hmr-file:"'.length + 1;

        const endFileRegion = rule.conditionText.indexOf('"', startFileRegion);
        if (endFileRegion === -1) return null;
        // Empty file strings are invalid
        if (endFileRegion - startFileRegion <= 0) return null;

        CSSLoader.cssLoadId.id = int;
        CSSLoader.cssLoadId.node = sheet.ownerNode as HTMLStylableElement;
        CSSLoader.cssLoadId.sheet = sheet;
        CSSLoader.cssLoadId.file = rule.conditionText.substring(
          startFileRegion - 1,
          endFileRegion
        );

        return CSSLoader.cssLoadId;
      }
      default: {
        return null;
      }
    }
  }

  bundleId(): number {
    return CSSLoader.cssLoadId.bundle_id;
  }

  private findCSSLinkTag(id: number): CSSHMRInsertionPoint | null {
    let count = 0;
    let match: CSSHMRInsertionPoint = null;

    if (this.updateMethod === CSSUpdateMethod.cssObjectModel) {
      if (document.adoptedStyleSheets.length > 0) {
        count = document.adoptedStyleSheets.length;

        for (let i = 0; i < count && match === null; i++) {
          let cssRules: CSSRuleList;
          let sheet: CSSStyleSheet;
          let ruleCount = 0;
          // Non-same origin stylesheets will potentially throw "Security error"
          // We will ignore those stylesheets and look at others.
          try {
            sheet = document.adoptedStyleSheets[i];
            cssRules = sheet.rules;
            ruleCount = sheet.rules.length;
          } catch (exception) {
            continue;
          }

          if (sheet.disabled || sheet.rules.length === 0) {
            continue;
          }

          const bundleIdRule = cssRules[0] as CSSSupportsRule;
          if (
            bundleIdRule.type !== 12 ||
            !bundleIdRule.conditionText.startsWith("(hmr-bid:")
          ) {
            continue;
          }

          const bundleIdEnd = bundleIdRule.conditionText.indexOf(
            ")",
            "(hmr-bid:".length + 1
          );
          if (bundleIdEnd === -1) continue;

          CSSLoader.cssLoadId.bundle_id = parseInt(
            bundleIdRule.conditionText.substring(
              "(hmr-bid:".length,
              bundleIdEnd
            ),
            10
          );

          for (let j = 1; j < ruleCount && match === null; j++) {
            match = this.findMatchingSupportsRule(
              cssRules[j] as CSSSupportsRule,
              id,
              sheet
            );
          }
        }
      }
    }

    count = document.styleSheets.length;

    for (let i = 0; i < count && match === null; i++) {
      let cssRules: CSSRuleList;
      let sheet: CSSStyleSheet;
      let ruleCount = 0;
      // Non-same origin stylesheets will potentially throw "Security error"
      // We will ignore those stylesheets and look at others.
      try {
        sheet = document.styleSheets.item(i);
        cssRules = sheet.rules;
        ruleCount = sheet.rules.length;
      } catch (exception) {
        continue;
      }

      if (sheet.disabled || sheet.rules.length === 0) {
        continue;
      }

      const bundleIdRule = cssRules[0] as CSSSupportsRule;
      if (
        bundleIdRule.type !== 12 ||
        !bundleIdRule.conditionText.startsWith("(hmr-bid:")
      ) {
        continue;
      }

      const bundleIdEnd = bundleIdRule.conditionText.indexOf(
        ")",
        "(hmr-bid:".length + 1
      );
      if (bundleIdEnd === -1) continue;

      CSSLoader.cssLoadId.bundle_id = parseInt(
        bundleIdRule.conditionText.substring("(hmr-bid:".length, bundleIdEnd),
        10
      );

      for (let j = 1; j < ruleCount && match === null; j++) {
        match = this.findMatchingSupportsRule(
          cssRules[j] as CSSSupportsRule,
          id,
          sheet
        );
      }
    }

    // Ensure we don't leak the HTMLLinkElement
    if (match === null) {
      CSSLoader.cssLoadId.file = "";
      CSSLoader.cssLoadId.bundle_id = CSSLoader.cssLoadId.id = 0;
      CSSLoader.cssLoadId.node = null;
      CSSLoader.cssLoadId.sheet = null;
    }

    return match;
  }

  handleBuildSuccess(
    buffer: ByteBuffer,
    build: API.WebsocketMessageBuildSuccess,
    timestamp: number
  ) {
    const start = performance.now();
    var update = this.findCSSLinkTag(build.id);
    let bytes =
      buffer._data.length > buffer._index
        ? buffer._data.subarray(buffer._index)
        : new Uint8Array(0);
    if (update === null) {
      __hmrlog.debug("Skipping unused CSS.");
      return;
    }

    if (bytes.length === 0) {
      __hmrlog.debug("Skipping empty file");
      return;
    }

    let filepath = update.file;
    const _timestamp = timestamp;
    const from_timestamp = build.from_timestamp;
    function onLoadHandler() {
      const localDuration = formatDuration(performance.now() - start);
      const fsDuration = _timestamp - from_timestamp;
      __hmrlog.log(
        "Reloaded in",
        `${localDuration + fsDuration}ms`,
        "-",
        filepath
      );

      update = null;
      filepath = null;
    }

    // Whenever
    switch (this.updateMethod) {
      case CSSUpdateMethod.blobURL: {
        let blob = new Blob([bytes], { type: "text/css" });

        const blobURL = URL.createObjectURL(blob);
        // onLoad doesn't fire in Chrome.
        // I'm not sure why.
        // Guessing it only triggers when an element is added/removed, not when the href just changes
        // So we say on the next tick, we're loaded.
        setTimeout(onLoadHandler.bind(update.node), 0);
        update.node.setAttribute("href", blobURL);
        blob = null;
        URL.revokeObjectURL(blobURL);
        break;
      }
      case CSSUpdateMethod.cssObjectModel: {
        if (!this.decoder) {
          this.decoder = new TextDecoder("UTF8");
        }

        // This is an adoptedStyleSheet, call replaceSync and be done with it.
        if (!update.node || update.node.tagName === "HTML") {
          update.sheet.replaceSync(this.decoder.decode(bytes));
        } else if (
          update.node.tagName === "LINK" ||
          update.node.tagName === "STYLE"
        ) {
          // This might cause CSS specifity issues....
          // I'm not 100% sure this is a safe operation
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(this.decoder.decode(bytes));
          update.node.remove();
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        }
        break;
      }
    }

    buffer = null;
    bytes = null;
  }

  reload(timestamp: number) {
    // function onLoadHandler(load: Event) {
    //   const localDuration = formatDuration(performance.now() - start);
    //   const fsDuration = _timestamp - from_timestamp;
    //   __hmrlog.log(
    //     "Reloaded in",
    //     `${localDuration + fsDuration}ms`,
    //     "-",
    //     filepath
    //   );

    //   blob = null;
    //   update = null;
    //   filepath = null;

    //   if (this.href.includes("blob:")) {
    //     URL.revokeObjectURL(this.href);
    //   }
    // }

    const url = new URL(CSSLoader.cssLoadId.node.href, location.href);
    url.searchParams.set("v", timestamp.toString(10));
    CSSLoader.cssLoadId.node.setAttribute("href", url.toString());
  }

  filePath(
    file_change_notification: API.WebsocketMessageFileChangeNotification
  ): string | null {
    if (file_change_notification.loader !== API.Loader.css) return null;
    const tag = this.findCSSLinkTag(file_change_notification.id);

    if (!tag) {
      return null;
    }

    return tag.file;
  }
}

class HMRClient {
  static client: HMRClient;
  socket: WebSocket;
  hasWelcomed: boolean = false;
  reconnect: number = 0;
  // Server timestamps are relative to the time the server's HTTP server launched
  // This so we can send timestamps as uint32 instead of 128-bit integers
  epoch: number = 0;

  loaders = {
    css: new CSSLoader(),
  };
  start() {
    if (runOnce) {
      __hmrlog.warn(
        "Attempted to start HMR client multiple times. This may be a bug."
      );
      return;
    }

    this.loaders.css.hmr = this;
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
    // Support browser-like envirnments where location and WebSocket exist
    // Maybe it'll work in Deno! Who knows.
    if (
      this.client ||
      typeof location === "undefined" ||
      typeof WebSocket === "undefined"
    ) {
      return;
    }

    this.client = new HMRClient();
    this.client.verbose = verbose;
    this.client.start();
    globalThis["SPEEDY_HMR"] = this.client;
  }

  handleBuildFailure(buffer: ByteBuffer, timestamp: number) {
    const build = API.decodeWebsocketMessageBuildFailure(buffer);
    const id = build.id;

    const index = this.indexOfModuleId(id);
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
    const build = API.decodeWebsocketMessageBuildSuccess(buffer);

    // Ignore builds of modules we expect a later version of
    const currentVersion = this.builds.get(build.id) || -Infinity;

    if (currentVersion > build.from_timestamp) {
      if (this.verbose) {
        __hmrlog.debug(
          `Ignoring outdated update for "${build.module_path}".\n  Expected: >=`,
          currentVersion,
          `\n   Received:`,
          build.from_timestamp
        );
      }
      return;
    }

    if (build.loader === API.Loader.css) {
      return this.loaders.css.handleBuildSuccess(buffer, build, timestamp);
    }

    const id = build.id;
    const index = this.indexOfModuleId(id);
    // Ignore builds of modules that are not loaded
    if (index === -1) {
      if (this.verbose) {
        __hmrlog.debug(`Skipping reload for unknown module id:`, id);
      }

      return;
    }

    if (this.verbose) {
      __hmrlog.debug(
        "Preparing to reload",
        HMRModule.dependencies.modules[index].file_path
      );
    }

    var reload = new HotReload(
      build.id,
      index,
      build,
      // These are the bytes!!
      buffer._data.length > buffer._index
        ? buffer._data.subarray(buffer._index)
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
    let file_path = "";
    switch (notification.loader) {
      case API.Loader.css: {
        file_path = this.loaders.css.filePath(notification);
        break;
      }

      default: {
        const index = HMRModule.dependencies.graph.indexOf(notification.id);

        if (index > -1) {
          file_path = HMRModule.dependencies.modules[index].file_path;
        }
        break;
      }
    }

    const accept = file_path && file_path.length > 0;

    if (!accept) {
      if (this.verbose) {
        __hmrlog.debug("Unknown module changed, skipping");
      }
      return;
    }

    if ((this.builds.get(notification.id) || -Infinity) > timestamp) {
      __hmrlog.debug(`Received update for ${file_path}`);
      return;
    }

    if (this.verbose) {
      __hmrlog.debug(`Requesting update for ${file_path}`);
    }

    this.builds.set(notification.id, timestamp);

    // When we're dealing with CSS, even though the watch event happened for a file in the bundle
    // We want it to regenerate the entire bundle
    // So we must swap out the ID we send for the ID of the corresponding bundle.
    if (notification.loader === API.Loader.css) {
      notification.id = this.loaders.css.bundleId();
      this.builds.set(notification.id, timestamp);
    }

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

    this.reconnect = globalThis.setInterval(this.connect, 500) as any as number;
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
      this.timings.import + this.timings.callbacks + this.timings.notify;
    return Promise.resolve([
      HMRModule.dependencies.modules[this.module_index],
      this.timings,
    ]);
  }
}

class DependencyGraph {
  modules: HMRModule[];
  graph: Uint32Array;
  graph_used = 0;

  loadDefaults() {
    this.modules = new Array<HMRModule>(32);
    this.graph = new Uint32Array(32);
    this.graph_used = 0;
  }

  static loadWithDefaults() {
    const graph = new DependencyGraph();
    graph.loadDefaults();
    return graph;
  }

  fork(offset: number) {
    const graph = new DependencyGraph();
    graph.modules = this.modules.slice();
    graph.graph_used = offset > 0 ? offset - 1 : 0;
    graph.graph = this.graph.slice();
    return graph;
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

  static _dependencies = DependencyGraph.loadWithDefaults();
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

  static dependencies: DependencyGraph;
  file_path: string;
  _load = function () {};
  id = 0;
  graph_index = 0;
  _exports = {};
  exports = {};
}

var __hmrlog = {
  debug(...args) {
    // console.debug("[speedy]", ...args);
    console.debug(...args);
  },
  error(...args) {
    // console.error("[speedy]", ...args);
    console.error(...args);
  },
  log(...args) {
    // console.log("[speedy]", ...args);
    console.log(...args);
  },
  warn(...args) {
    // console.warn("[speedy]", ...args);
    console.warn(...args);
  },
};

export { HMRModule as __HMRModule };
