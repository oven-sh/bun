import { ByteBuffer } from "peechy";
import * as API from "../api/schema";

var __HMRModule, __FastRefreshModule, __HMRClient, __injectFastRefresh;
if (typeof window !== "undefined") {
  var textEncoder: TextEncoder;
  // We add a scope here to minimize chances of namespace collisions
  var runOnce = false;
  var clientStartTime = 0;

  function formatDuration(duration: number) {
    return Math.round(duration * 1000) / 1000;
  }

  enum CSSImportState {
    Pending,
    Loading,
    Loaded,
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

  enum ReloadBehavior {
    fullReload,
    hotReload,
    ignore,
  }

  const FastRefreshLoader = {
    RefreshRuntime: null,
    isUpdateInProgress: false,
    hasInjectedFastRefresh: false,

    performFullRefresh() {
      HMRClient.client.performFullReload();
    },

    async hotReload() {
      if (FastRefreshLoader.isUpdateInProgress) return;

      try {
        FastRefreshLoader.isUpdateInProgress = true;
      } finally {
        FastRefreshLoader.isUpdateInProgress = false;
      }
    },
  };

  const BunError = {
    module: null,
    prom: null,
    cancel: false,
    lastError: null,
    render(error, cwd) {
      if ("__BunRenderBuildError" in globalThis) {
        globalThis.__BunRenderBuildError(error, cwd);
        return;
      }

      BunError.lastError = [error, cwd];
      BunError.cancel = false;

      if (!BunError.module) {
        if (BunError.prom) return;
        BunError.prom = import("/bun:error.js").then((mod) => {
          BunError.module = mod;
          !BunError.cancel &&
            BunError.render(BunError.lastError[0], BunError.lastError[1]);
        });
        return;
      }

      const { renderBuildFailure } = BunError.module;
      renderBuildFailure(BunError.lastError[0], BunError.lastError[1]);
    },

    clear() {
      BunError.lastError = null;
      BunError.cancel = true;

      if (BunError.module) {
        const { clearBuildFailure } = BunError.module;
        clearBuildFailure();
      } else if ("__BunClearBuildFailure" in globalThis) {
        globalThis.__BunClearBuildFailure();
      }
    },
  };

  class CSSLoader {
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

          const endFileRegion = rule.conditionText.indexOf(
            '"',
            startFileRegion
          );
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

    findCSSLinkTag(id: number): CSSHMRInsertionPoint | null {
      let count = 0;
      let match: CSSHMRInsertionPoint = null;

      const adoptedStyles = document.adoptedStyleSheets;

      if (this.updateMethod === CSSUpdateMethod.cssObjectModel) {
        if (adoptedStyles.length > 0) {
          count = adoptedStyles.length;

          for (let i = 0; i < count && match === null; i++) {
            let cssRules: CSSRuleList;
            let sheet: CSSStyleSheet;
            let ruleCount = 0;
            // Non-same origin stylesheets will potentially throw "Security error"
            // We will ignore those stylesheets and look at others.
            try {
              sheet = adoptedStyles[i];
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
        buffer.data.length > buffer.index
          ? buffer.data.subarray(buffer.index)
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
      // We cannot safely do this because the hash would change on the server
      if (filepath.startsWith(this.hmr.cwd)) {
        filepath = filepath.substring(this.hmr.cwd.length);
      }
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
            document.adoptedStyleSheets = [
              ...document.adoptedStyleSheets,
              sheet,
            ];
          }
          break;
        }
      }

      buffer = null;
      bytes = null;
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
    javascriptReloader: API.Reloader = API.Reloader.disable;
    loaders = {
      css: new CSSLoader(),
    };

    sessionId: number;

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

      // Explicitly send a socket close event so the thread doesn't have to wait for a timeout
      var origUnload = globalThis.onbeforeunload;
      globalThis.onbeforeunload = (ev: Event) => {
        this.disableReconnect = true;

        if (this.socket && this.socket.readyState === this.socket.OPEN) {
          this.socket.close(4990, "unload");
        }
        origUnload && origUnload.call(globalThis, [ev]);
      };
    }

    nextReconnectAttempt = 0;
    reconnectDelay = 16;
    debouncedReconnect = () => {
      if (
        this.socket &&
        (this.socket.readyState == this.socket.OPEN ||
          this.socket.readyState == this.socket.CONNECTING)
      )
        return;

      this.nextReconnectAttempt = setTimeout(
        this.attemptReconnect,
        this.reconnectDelay
      );
    };

    attemptReconnect = () => {
      globalThis.clearTimeout(this.nextReconnectAttempt);
      if (
        this.socket &&
        (this.socket.readyState == this.socket.OPEN ||
          this.socket.readyState == this.socket.CONNECTING)
      )
        return;
      this.connect();
      this.reconnectDelay += Math.floor(Math.random() * 128);
    };

    connect() {
      if (
        this.socket &&
        (this.socket.readyState == this.socket.OPEN ||
          this.socket.readyState == this.socket.CONNECTING)
      )
        return;

      clientStartTime = performance.now();

      const baseURL = new URL(location.origin + "/bun:_api.hmr");
      baseURL.protocol = location.protocol === "https:" ? "wss" : "ws";
      this.socket = new WebSocket(baseURL.toString(), ["bun-hmr"]);
      this.socket.binaryType = "arraybuffer";
      this.socket.onclose = this.handleClose;
      this.socket.onerror = this.handleError;
      this.socket.onopen = this.handleOpen;
      this.socket.onmessage = this.handleMessage;
    }

    // key: module id
    // value: server-timestamp
    builds = new Map<number, number>();
    cwd: string;

    indexOfModuleId(id: number): number {
      return HMRModule.dependencies.graph.indexOf(id);
    }

    static cssQueue = [];
    static cssState = CSSImportState.Pending;
    static cssAutoFOUC = false;

    static processPendingCSSImports() {
      const pending = HMRClient.cssQueue.slice();
      HMRClient.cssQueue.length = 0;
      return Promise.all(pending).then(() => {
        if (HMRClient.cssQueue.length > 0) {
          const _pending = HMRClient.cssQueue.slice();
          HMRClient.cssQueue.length = 0;
          return Promise.all(_pending).then(HMRClient.processPendingCSSImports);
        } else {
          return true;
        }
      });
    }

    static importCSS(promise: Promise<unknown>) {
      switch (HMRClient.cssState) {
        case CSSImportState.Pending: {
          this.cssState = CSSImportState.Loading;
          // This means we can import without risk of FOUC
          if (
            document.documentElement.innerText === "" &&
            !HMRClient.cssAutoFOUC
          ) {
            if (document.body) document.body.style.visibility = "hidden";
            HMRClient.cssAutoFOUC = true;
          }

          promise.then(this.processPendingCSSImports).finally(() => {
            if (HMRClient.cssAutoFOUC) {
              // "delete" doesn't work here. Not sure why.
              if (document.body) {
                // Force layout
                window.getComputedStyle(document.body);

                document.body.style.visibility = "visible";
              }
              HMRClient.cssAutoFOUC = false;
            }
            this.cssState = CSSImportState.Loaded;
          });
          break;
        }
        case CSSImportState.Loaded: {
          promise.then(
            () => {},
            () => {}
          );
          break;
        }
        case CSSImportState.Loading: {
          this.cssQueue.push(promise);
          break;
        }
      }
    }

    static allImportedStyles = new Set();
    static onCSSImport(event) {
      HMRClient.allImportedStyles.add(event.detail);

      if (globalThis["Bun_disableCSSImports"]) {
        return;
      }

      const url = event.detail;

      if (typeof url !== "string" || url.length === 0) {
        console.warn("[CSS Importer] Received invalid CSS import", url);
        return;
      }

      const thisURL = new URL(url, location.origin);

      for (let i = 0; i < document.styleSheets.length; i++) {
        const sheet = document.styleSheets[i];
        if (!sheet.href) continue;

        if (sheet.href === url) {
          // Already imported
          return;
        }

        try {
          const _url1 = new URL(sheet.href, location.origin);

          if (_url1.pathname === thisURL.pathname) {
            // Already imported
            return;
          }
        } catch (e) {}
      }

      const urlString = thisURL.toString();
      HMRClient.importCSS(
        new Promise((resolve, reject) => {
          if (globalThis["Bun_disableCSSImports"]) {
            return;
          }

          var link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = urlString;
          link.onload = () => {
            resolve();
          };

          link.onerror = (evt) => {
            console.error(
              `[CSS Importer] Error loading CSS file: ${urlString}\n`,
              evt.toString()
            );
            reject();
          };
          document.head.appendChild(link);
        }).then(() => Promise.resolve())
      );
    }
    static activate(verbose: boolean = false) {
      // Support browser-like envirnments where location and WebSocket exist
      // Maybe it'll work in Deno! Who knows.
      if (
        this.client ||
        !("location" in globalThis) ||
        !("WebSocket" in globalThis)
      ) {
        return;
      }

      this.client = new HMRClient();
      // if (
      //   "sessionStorage" in globalThis &&
      //   globalThis.sessionStorage.getItem("bun-hmr-session-id")
      // ) {
      //   this.client.sessionId = parseInt(
      //     globalThis.sessionStorage.getItem("bun-hmr-session-id"),
      //     16
      //   );
      // } else {
      //   this.client.sessionId = Math.floor(Math.random() * 65534);
      //   if ("sessionStorage" in globalThis) {
      //     try {
      //       globalThis.sessionStorage.setItem(
      //         "bun-hmr-session-id",
      //         this.client.sessionId.toString(16)
      //       );
      //     } catch (exception) {}
      //   }
      // }
      this.client.verbose = verbose;
      this.client.start();
      globalThis["__BUN_HMR"] = this.client;
    }

    handleBuildFailure(buffer: ByteBuffer, timestamp: number) {
      const build = API.decodeWebsocketMessageBuildFailure(buffer);
      const id = build.id;

      // const index = this.indexOfModuleId(id);
      // // Ignore build failures of modules that are not loaded
      // if (index === -1) {
      //   this.maybeReportBuildFailure(build);
      //   return;
      // }

      // // Build failed for a module we didn't request?
      // const minTimestamp = this.builds.get(index);
      // if (!minTimestamp) {
      //   return;
      // }
      // const fail = API.decodeWebsocketMessageBuildFailure(buffer);

      this.reportBuildFailure(build);
    }

    maybeReportBuildFailure(failure: API.WebsocketMessageBuildFailure) {
      BunError.render(failure, this.cwd);
    }

    needsConsoleClear = false;

    reportBuildFailure(failure: API.WebsocketMessageBuildFailure) {
      BunError.render(failure, this.cwd);

      console.group(
        `Build failed: ${failure.module_path} (${failure.log.errors} errors)`
      );
      this.needsConsoleClear = true;
      for (let msg of failure.log.msgs) {
        var logFunction;
        switch (msg.level) {
          case API.MessageLevel.err: {
            logFunction = console.error;
            break;
          }
          case API.MessageLevel.warn: {
            logFunction = console.warn;
            break;
          }
          default: {
            logFunction = console.info;
            break;
          }
        }

        const { text, location } = msg.data;
        var output = "";

        if (location) {
          if (location.line > -1 && location.column > -1) {
            output += `${location.file}:${location.line}:${location.column}`;
          } else if (location.line > -1) {
            output += `${location.file}:${location.line}`;
          } else if (location.file.length > 0) {
            output += `${location.file}`;
          }
        }
        if (location && location.line_text) {
          output = output.trimRight() + "\n" + location.line_text.trim();
        }

        output = output.trimRight() + "\n " + text;

        logFunction(output.trim());
      }
      console.groupEnd();
    }

    verbose = false;

    handleError = (error: ErrorEvent) => {
      __hmrlog.error("Websocket error", error.error);
      if (this.reconnect !== 0) {
        return;
      }
      this.debouncedReconnect();
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
        BunError.clear();
        if (this.needsConsoleClear) {
          console.clear();
          this.needsConsoleClear = false;
        }
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
        var filepath = HMRModule.dependencies.modules[index].file_path;
        if (filepath.startsWith(this.cwd)) {
          filepath = filepath.substring(this.cwd.length);
        }
        __hmrlog.debug("Preparing to reload", filepath);
      }

      var reload = new HotReload(
        build.id,
        index,
        build,
        // These are the bytes!!
        buffer.data.length > buffer.index
          ? buffer.data.subarray(buffer.index)
          : new Uint8Array(0),
        ReloadBehavior.hotReload
      );
      reload.timings.notify = timestamp - build.from_timestamp;

      BunError.clear();

      reload.run().then(
        ([module, timings]) => {
          var filepath = module.file_path;

          if (filepath.startsWith(this.cwd)) {
            filepath = filepath.substring(this.cwd.length);
          }

          if (this.needsConsoleClear) {
            console.clear();
            this.needsConsoleClear = false;
          }

          __hmrlog.log(
            `[${formatDuration(timings.total)}ms] Reloaded`,
            filepath
          );
        },
        (err) => {
          if (
            typeof err === "object" &&
            err &&
            err instanceof ThrottleModuleUpdateError
          ) {
            return;
          }
          __hmrlog.error("Hot Module Reload failed!", err);
          debugger;
        }
      );
    }

    performFullReload() {
      if (typeof location !== "undefined") {
        if (this.socket.readyState === this.socket.OPEN) {
          // Disable reconnecting
          this.reconnect = 1;
          this.socket.close();
        }
        location.reload();
      }
    }

    handleFileChangeNotification(
      buffer: ByteBuffer,
      timestamp: number,
      copy_file_path: boolean
    ) {
      const notification =
        API.decodeWebsocketMessageFileChangeNotification(buffer);
      let file_path = "";
      switch (notification.loader) {
        case API.Loader.css: {
          file_path = this.loaders.css.filePath(notification);
          break;
        }

        case API.Loader.js:
        case API.Loader.jsx:
        case API.Loader.tsx:
        case API.Loader.ts:
        case API.Loader.json: {
          const index = HMRModule.dependencies.graph
            .subarray(0, HMRModule.dependencies.graph_used)
            .indexOf(notification.id);

          if (index > -1 && index) {
            file_path = HMRModule.dependencies.modules[index].file_path;
          }
          break;
        }
        
        default: {
          return;
        }
      }

      return this.handleFileChangeNotificationBase(
        timestamp,
        notification,
        file_path,
        copy_file_path
      );
    }

    private handleFileChangeNotificationBase(
      timestamp: number,
      notification: API.WebsocketMessageFileChangeNotification,
      file_path: string,
      copy_file_path: boolean
    ) {
      const accept = file_path && file_path.length > 0;

      if (!accept) {
        if (this.verbose) {
          __hmrlog.debug("Unknown module changed, skipping");
        }
        return;
      }

      if ((this.builds.get(notification.id) || -Infinity) > timestamp) {
        __hmrlog.debug(`Received stale update for ${file_path}`);
        return;
      }

      let reloadBehavior = ReloadBehavior.ignore;

      switch (notification.loader) {
        // CSS always supports hot reloading
        case API.Loader.css: {
          this.builds.set(notification.id, timestamp);
          // When we're dealing with CSS, even though the watch event happened for a file in the bundle
          // We want it to regenerate the entire bundle
          // So we must swap out the ID we send for the ID of the corresponding bundle.
          notification.id = this.loaders.css.bundleId();
          this.builds.set(notification.id, timestamp);
          reloadBehavior = ReloadBehavior.hotReload;
          break;
        }
        // The backend will detect if they have react-refresh in their bundle
        // If so, it will use it.
        // Else, it will fall back to live reloading.
        case API.Loader.js:
        case API.Loader.jsx:
        case API.Loader.json:
        case API.Loader.ts:
        case API.Loader.tsx: {
          switch (this.javascriptReloader) {
            case API.Reloader.disable: {
              break;
            }
            case API.Reloader.fast_refresh: {
              this.builds.set(notification.id, timestamp);
              reloadBehavior = ReloadBehavior.hotReload;
              break;
            }
            case API.Reloader.live: {
              reloadBehavior = ReloadBehavior.fullReload;
              break;
            }
          }
          break;
        }
      }

      switch (reloadBehavior) {
        // This is the same command/logic for both JS and CSS hot reloading.
        case ReloadBehavior.hotReload: {
          if (copy_file_path && !this.buildCommandBufWithFilePath) {
            // on Linux, max file path length is 4096 bytes
            // on macOS & Windows, max file path length is 1024 bytes
            // 256 is extra breathing room
            this.buildCommandBufWithFilePath = new Uint8Array(4096 + 256);
          }

          const writeBuffer = !copy_file_path
            ? this.buildCommandBuf
            : this.buildCommandBufWithFilePath;
          writeBuffer[0] = !copy_file_path
            ? API.WebsocketCommandKind.build
            : API.WebsocketCommandKind.build_with_file_path;
          this.buildCommandUArray[0] = timestamp;
          writeBuffer.set(this.buildCommandUArrayEight, 1);
          this.buildCommandUArray[0] = notification.id;
          writeBuffer.set(this.buildCommandUArrayEight, 5);

          if (copy_file_path) {
            if (!textEncoder) {
              textEncoder = new TextEncoder();
            }

            this.buildCommandUArray[0] = file_path.length;
            writeBuffer.set(this.buildCommandUArrayEight, 9);

            const out = textEncoder.encodeInto(
              file_path,
              writeBuffer.subarray(13)
            );
            this.socket.send(
              this.buildCommandBufWithFilePath.subarray(0, 13 + out.written)
            );
          } else {
            this.socket.send(this.buildCommandBuf);
          }

          if (this.verbose) {
            __hmrlog.debug(`Requesting update for ${file_path}`);
          }
          break;
        }

        case ReloadBehavior.fullReload: {
          this.performFullReload();
          break;
        }
      }
    }

    buildCommandBuf = new Uint8Array(9);
    buildCommandUArray = new Uint32Array(1);
    buildCommandUArrayEight = new Uint8Array(this.buildCommandUArray.buffer);

    // lazily allocate because it's going to be much larger than 9 bytes
    buildCommandBufWithFilePath: Uint8Array;

    // On open, reset the delay for reconnecting
    handleOpen = (event: Event) => {
      globalThis.clearTimeout(this.nextReconnectAttempt);
      setTimeout(() => {
        if (this.socket && this.socket.readyState == this.socket.OPEN) {
          globalThis.clearTimeout(this.nextReconnectAttempt);
          this.reconnectDelay = 16;
        }
      }, 16);
    };

    handleMessage = (event: MessageEvent) => {
      const data = new Uint8Array(event.data);
      const message_header_byte_buffer = new ByteBuffer(data);
      const header = API.decodeWebsocketMessage(message_header_byte_buffer);
      const buffer = new ByteBuffer(
        data.subarray(message_header_byte_buffer.index)
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

        case API.WebsocketMessageKind.resolve_file: {
          const { id } = API.decodeWebsocketMessageResolveID(buffer);
          const timestamp = this.builds.get(id) || 0;

          if (timestamp == 0 && HotReload.VERBOSE) {
            __hmrlog.debug(`Unknown module? ${id}`);
            return;
          }

          const index = HMRModule.dependencies.graph
            .subarray(0, HMRModule.dependencies.graph_used)
            .indexOf(id);
          var file_path: string = "";
          var loader = API.Loader.js;
          if (index > -1) {
            file_path = HMRModule.dependencies.modules[index].file_path;
          } else {
            const tag = this.loaders.css.findCSSLinkTag(id);
            if (tag && tag.file.length) {
              file_path = tag.file;
            }
          }

          if (!file_path || file_path.length === 0) {
            if (HotReload.VERBOSE) {
              __hmrlog.debug(`Unknown module? ${id}`);
            }
            return;
          }

          switch (file_path.substring(file_path.lastIndexOf("."))) {
            case ".css": {
              loader = API.Loader.css;
              break;
            }

            case ".mjs":
            case ".cjs":
            case ".js": {
              loader = API.Loader.js;
              break;
            }

            case ".json": {
              loader = API.Loader.json;
              break;
            }

            case ".cts":
            case ".mts":
            case ".ts": {
              loader = API.Loader.ts;
              break;
            }

            case ".tsx": {
              loader = API.Loader.tsx;
              break;
            }

            case ".jsx": {
              loader = API.Loader.jsx;
              break;
            }

            default: {
              loader = API.Loader.file;
              break;
            }
          }

          this.handleFileChangeNotificationBase(
            timestamp,
            { id, loader },
            file_path,
            true
          );
          break;
        }
        case API.WebsocketMessageKind.file_change_notification: {
          this.handleFileChangeNotification(buffer, header.timestamp, false);
          break;
        }
        case API.WebsocketMessageKind.file_change_notification_with_hint: {
          this.handleFileChangeNotification(buffer, header.timestamp, true);
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
          this.javascriptReloader = welcome.javascriptReloader;
          this.cwd = welcome.cwd;
          if (!this.epoch) {
            __hmrlog.warn("Internal HMR error");
          }
          break;
        }
      }
    };

    disableReconnect = false;

    handleClose = (event: CloseEvent) => {
      if (this.reconnect !== 0 || this.disableReconnect) {
        return;
      }

      this.debouncedReconnect();
    };
  }
  let pendingUpdateCount = 0;

  class ThrottleModuleUpdateError extends Error {
    constructor(message) {
      super(message);
    }
  }

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
    reloader: ReloadBehavior;

    constructor(
      module_id: HotReload["module_id"],
      module_index: HotReload["module_index"],
      build: HotReload["build"],
      bytes: Uint8Array,
      reloader: ReloadBehavior
    ) {
      this.module_id = module_id;
      this.module_index = module_index;
      this.build = build;
      this.bytes = bytes;
      this.reloader = reloader;
    }

    async run() {
      pendingUpdateCount++;
      let result: [HMRModule, HotReload["timings"]];
      try {
        result = await this._run();
      } finally {
        pendingUpdateCount--;
      }

      return result;
    }

    private async _run(): Promise<[HMRModule, HotReload["timings"]]> {
      const currentPendingUpdateCount = pendingUpdateCount;

      const importStart = performance.now();
      let orig_deps = HMRModule.dependencies;
      // we must preserve the updater since that holds references to the real exports.
      // this is a fundamental limitation of using esmodules for HMR.
      // we cannot export new modules. we can only mutate existing ones.

      const oldGraphUsed = HMRModule.dependencies.graph_used;
      var oldModule = HMRModule.dependencies.modules[this.module_index];
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

        if ("__BunRenderHMRError" in globalThis) {
          globalThis.__BunRenderHMRError(
            exception,
            oldModule.file_path,
            oldModule.id
          );
        }

        oldModule = null;
        throw exception;
      }

      // We didn't import any new modules, so we resume as before.
      if (HMRModule.dependencies.graph_used === this.module_index) {
        HMRModule.dependencies.graph_used = oldGraphUsed;
      } else {
        // If we do import a new module, we have to do a full page reload for now
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
      const origUpdaters = oldModule
        ? oldModule.additional_updaters.slice()
        : [];
      try {
        switch (this.reloader) {
          case ReloadBehavior.hotReload: {
            let foundBoundary = false;

            const isOldModuleDead =
              oldModule &&
              oldModule.previousVersion &&
              oldModule.previousVersion.id === oldModule.id &&
              oldModule.hasSameExports(oldModule.previousVersion);

            if (oldModule) {
              // ESM-based HMR has a disadvantage against CommonJS HMR
              // ES Namespace objects are not [[Configurable]]
              // That means we have to loop through all previous versions of updated modules that that have unique export names
              // and updates those exports specifically
              // Otherwise, changes will not be reflected properly
              // However, we only need to loop through modules that add or remove exports, i.e. those are ones which have "real" exports
              if (!isOldModuleDead) {
                HMRModule.dependencies.modules[
                  this.module_index
                ].additional_updaters.push(oldModule.update.bind(oldModule));
                HMRModule.dependencies.modules[
                  this.module_index
                ].previousVersion = oldModule;
              } else {
                HMRModule.dependencies.modules[
                  this.module_index
                ].previousVersion = oldModule.previousVersion;
                HMRModule.dependencies.modules[
                  this.module_index
                ].additional_updaters = origUpdaters;
              }
            }

            const end = Math.min(
              this.module_index + 1,
              HMRModule.dependencies.graph_used
            );
            // -- For generic hot reloading --
            // ES Modules delay execution until all imports are parsed
            // They execute depth-first
            // If you load N modules and append each module ID to the array, 0 is the *last* unique module imported.
            // modules.length - 1 is the first.
            // Therefore, to reload all the modules in the correct order, we traverse the graph backwards
            // This only works when the graph is up to date.
            // If the import order changes, we need to regenerate the entire graph
            // Which sounds expensive, until you realize that we are mostly talking about an array that will be typically less than 1024 elements
            // Computers can create an array of < 1024 pointer-sized elements in < 1ms easy!
            // --

            // -- For React Fast Refresh --
            // We must find a React Refresh boundary. This is a module that only exports React components.
            // If we do not find a React Refresh boundary, we must instead perform a full page reload.
            for (
              let i = 0;
              i <= end;
              i++ // let i = HMRModule.dependencies.graph_used - 1; // i > this.module_index; // i--
            ) {
              const mod = HMRModule.dependencies.modules[i];
              let handled = false;

              if (!mod.exports.__hmrDisable) {
                if (typeof mod.dispose === "function") {
                  mod.dispose();
                  handled = true;
                }
                if (typeof mod.accept === "function") {
                  mod.accept();
                  handled = true;
                }

                // If we don't find a boundary, we will need to do a full page load
                if ((mod as FastRefreshModule).isRefreshBoundary) {
                  foundBoundary = true;
                }

                // Automatically re-initialize the dependency
                if (!handled) {
                  mod.update();
                }
              }
            }

            // By the time we get here, it's entirely possible that another update is waiting
            // Instead of scheduling it, we are going to just ignore this update.
            // But we still need to re-initialize modules regardless because otherwise a dependency may not reload properly
            if (
              pendingUpdateCount === currentPendingUpdateCount &&
              foundBoundary
            ) {
              FastRefreshLoader.RefreshRuntime.performReactRefresh();
              // Remove potential memory leak
              if (isOldModuleDead) oldModule.previousVersion = null;
            } else if (pendingUpdateCount === currentPendingUpdateCount) {
              FastRefreshLoader.performFullRefresh();
            } else {
              return Promise.reject(
                new ThrottleModuleUpdateError(
                  `Expected pendingUpdateCount: ${currentPendingUpdateCount} but received: ${pendingUpdateCount}`
                )
              );
            }

            break;
          }
        }
      } catch (exception) {
        HMRModule.dependencies = orig_deps;
        HMRModule.dependencies.modules[this.module_index].additional_updaters =
          origUpdaters;
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

  type AnyHMRModule = HMRModule | FastRefreshModule;
  class DependencyGraph {
    modules: AnyHMRModule[];
    graph: Uint32Array;
    graph_used = 0;

    loadDefaults() {
      this.modules = new Array<AnyHMRModule>(32);
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
      graph.graph_used = offset;
      graph.graph = this.graph.slice();
      return graph;
    }
  }

  class HMRModule {
    constructor(id: number, file_path: string) {
      this.id = id;
      this.file_path = file_path;

      Object.defineProperty(this, "name", {
        get() {
          return this.file_path;
        },
        configurable: false,
        enumerable: false,
      });

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

      HMRModule.dependencies.modules[this.graph_index] = this;
      HMRModule.dependencies.graph[this.graph_index] = this.id;
    }

    previousVersion = null;

    hasSameExports(that: AnyHMRModule) {
      const thisKeys = Object.keys(this.exports);
      const thatKeys = Object.keys(that.exports);
      if (thisKeys.length !== thatKeys.length) {
        return false;
      }

      for (let i = 0; i < thisKeys.length; i++) {
        if (thisKeys[i] !== thatKeys[i]) {
          return false;
        }
      }

      return true;
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

  function injectFastRefresh(RefreshRuntime) {
    if (!FastRefreshLoader.hasInjectedFastRefresh) {
      RefreshRuntime.injectIntoGlobalHook(globalThis);
      FastRefreshLoader.hasInjectedFastRefresh = true;
    }
  }

  class FastRefreshModule extends HMRModule {
    constructor(id: number, file_path: string, RefreshRuntime: any) {
      super(id, file_path);

      // 4,000,000,000 in base36 occupies 7 characters
      // file path is probably longer
      // small strings are better strings
      this.refreshRuntimeBaseID =
        (this.file_path.length > 7 ? this.id.toString(36) : this.file_path) +
        "/";
      FastRefreshLoader.RefreshRuntime =
        FastRefreshLoader.RefreshRuntime || RefreshRuntime;

      if (!FastRefreshLoader.hasInjectedFastRefresh) {
        RefreshRuntime.injectIntoGlobalHook(globalThis);
        FastRefreshLoader.hasInjectedFastRefresh = true;
      }
    }

    refreshRuntimeBaseID: string;
    isRefreshBoundary = false;

    // $RefreshReg$
    $r_(Component: any, id: string) {
      FastRefreshLoader.RefreshRuntime.register(
        Component,
        this.refreshRuntimeBaseID + id
      );
    }
    // $RefreshReg$(Component, Component.name || Component.displayName)
    $r(Component: any) {
      if (!FastRefreshLoader.RefreshRuntime.isLikelyComponentType(Component)) {
        return;
      }

      this.$r_(Component, Component.name || Component.displayName);
    }

    // Auto-register exported React components so we only have to manually register the non-exported ones
    // This is what Metro does: https://github.com/facebook/metro/blob/9f2b1210a0f66378dd93e5fcaabc464c86c9e236/packages/metro-runtime/src/polyfills/require.js#L905
    exportAll(object: any) {
      super.exportAll(object);

      // One thing I'm unsure of:
      //   Do we need to register the exports object iself? Is it important for some namespacing thing?
      //   Metro seems to do that. However, that might be an artifact of CommonJS modules. People do module.exports = SomeReactComponent.
      var hasExports = false;
      var onlyExportsComponents = true;
      for (const key in object) {
        if (key === "__esModule") {
          continue;
        }

        hasExports = true;

        // Everything in here should always be a function
        // exportAll({blah: () => blah})
        // If you see exception right here, please file an issue and include the source file in the issue.
        const Component = object[key]();

        // Ensure exported React components always have names
        // This is for simpler debugging
        if (
          Component &&
          typeof Component === "function" &&
          !("name" in Component) &&
          Object.isExtensible(Component)
        ) {
          const named = {
            get() {
              return key;
            },
            enumerable: false,
            configurable: true,
          };
          // Ignore any errors if it turns out this was already set as not configurable
          try {
            // "name" is the official JavaScript way
            // "displayName" is the legacy React way
            Object.defineProperties(Component, {
              name: named,
              displayName: named,
            });
          } catch (exception) {}
        }

        if (
          !FastRefreshLoader.RefreshRuntime.isLikelyComponentType(Component)
        ) {
          onlyExportsComponents = false;
          // We can't stop here because we may have other exports which are components that need to be registered.
          continue;
        }

        this.$r_(Component, key);
      }

      this.isRefreshBoundary = hasExports && onlyExportsComponents;
    }

    loaded(_onUpdate) {
      this._update = _onUpdate;
    }
  }

  var __hmrlog = {
    debug(...args) {
      // console.debug("[bun]", ...args);
      console.debug(...args);
    },
    error(...args) {
      // console.error("[bun]", ...args);
      console.error(...args);
    },
    log(...args) {
      // console.log("[bun]", ...args);
      console.log(...args);
    },
    warn(...args) {
      // console.warn("[bun]", ...args);
      console.warn(...args);
    },
  };

  // __HMRModule = FastRefreshModule;
  __HMRModule = HMRModule;
  __FastRefreshModule = FastRefreshModule;
  __HMRClient = HMRClient;
  __injectFastRefresh = injectFastRefresh;
  if ("document" in globalThis) {
    document.addEventListener("onimportcss", HMRClient.onCSSImport, {
      passive: true,
    });

    // window.addEventListener("error", HMRClient.onError, { passive: true });
  }
  globalThis["__BUN"] = HMRClient;
}

export { __HMRModule, __FastRefreshModule, __HMRClient, __injectFastRefresh };
