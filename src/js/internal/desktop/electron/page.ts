// A document, as the main realm sees it: what its realm may ask for.
const fs = require("node:fs");
const path = require("node:path");
const native = require("internal/desktop/native");
const { app, Event } = require("internal/desktop/app");
const compiled = require("internal/desktop/electron/compiled");
const loader = require("internal/desktop/electron/loader");
const policy = require("internal/desktop/electron/policy");
const { Client, canPreload, languages, timingOf } = require("internal/desktop/electron/page_network");
const mime = require("internal/desktop/web/mime");
const { queueTask } = require("internal/desktop/electron/stubs");
const tasks = require("internal/desktop/tasks");
const createRealm = $newCppFunction("DesktopRealm.cpp", "jsFunctionCreateDesktopRealm", 0);

const PRELOAD_WORLD = 999;
const PRELOAD_PARAMETERS =
  "require,process,Buffer,global,setImmediate,clearImmediate,exports,module,__filename,__dirname";
const CHROME_VERSION = process.versions.chrome;
const paths = new WeakMap<object, string>();
const system = () => require("internal/desktop/system").api;
const logsToStderr =
  !!process.env.ELECTRON_ENABLE_LOGGING || process.argv.some(it => it.startsWith("--enable-logging"));
const started = new Set<Page>();
const parentheses = /[()]/g;
const allowedToAll = /^(?:deferred-fetch-minimal|gamepad|picture-in-picture|storage-access|sync-xhr|unload)$/;
const inheritsOrigin = /^(?:about|javascript):/;
const inheritsPolicies = /^(?:about|blob|data|javascript):/;
let nextId = 1;

const aboutOpenedWindows = ["close", "disown", "getOpener", "isClosed", "isPopup", "navigateOther"];

class Page extends Client {
  id = nextId++;
  handle: any;
  title = "";
  /** What the previous document has captured, or 0. */
  inboundTransition = 0;
  isInitial!: boolean;
  controller: any;
  /** The `<iframe>`s in the web engine. */
  frames = new Set<any>();
  permissionsPolicy = "";
  /** By the ids of `executeJavaScriptInIsolatedWorld`. 0 is the page's own. */
  worlds = new Map<number, any>();
  #callbacks;
  #preferences;
  #response: any;
  #preload: any;
  #preloadWorld: any;
  #env: any;
  #lastCookies = { all: undefined, url: "", text: "" };
  #opener: { page: Page; createPage: Function } | undefined;
  context: any;
  agent: any;
  /** What it is allowed, if it is sandboxed. */
  sandbox: Set<string> | undefined;
  /** The same for the same origin, even an opaque one. */
  originKey: unknown;
  isLoaded = false;
  restoresScroll = false;
  framesCreated = 0;
  #container: any;
  /** By the element of the frame, when the navigation ended. */
  #declared = { allow: "", source: "" };
  #baseUrl: string | undefined;

  constructor(webContents: any, callbacks: any, url: string, options: any) {
    super(webContents, url);
    const { preferences, context, container } = callbacks.state();
    this.#callbacks = callbacks;
    this.#preferences = preferences;
    this.context = context;
    this.#container = container;
    this.parent = context.parent?.page;
    this.checksOrigins = preferences.webSecurity !== false;
    this.#configure(options);
  }

  /** `creator` is the document that an `about:` one inherits from. */
  #configure({ isInitial = false, headers = [], referrer = "", creator, sandbox, response, markup }: any) {
    const { url } = this;
    const inherits = creator !== undefined && inheritsOrigin.test(url);
    this.referrer = referrer;
    this.#response = response;
    this.status = response?.status ?? 200;
    this.isInitial = isInitial;
    this.origin = inherits ? creator.origin : policy.originOf(url);
    this.setPolicies(headers, inheritsPolicies.test(url) || markup !== undefined ? creator : undefined);
    const byPolicy: string[] | undefined = this.csp.sandbox();
    if (byPolicy) sandbox = new Set(byPolicy.filter(flag => sandbox?.has(flag) ?? true));
    this.sandbox = sandbox;
    const attribute = this.#container?.element.attribute;
    if (attribute) {
      const src = attribute("srcdoc") === null && URL.parse(attribute("src") || "", this.parent!.url)?.href;
      const allow = (attribute("allow") ?? "") + (attribute("allowfullscreen") === null ? "" : ";fullscreen *");
      this.#declared = { allow, source: src || this.parent!.origin };
    }
    const isOpaque = sandbox !== undefined && !sandbox.has("allow-same-origin");
    if (isOpaque) this.origin = "null";
    this.originKey = inherits && !isOpaque ? creator.originKey : this.origin === "null" ? {} : this.origin;
    this.#baseUrl = inherits ? (creator.baseUrl ?? creator.controller?.document.baseURI) : undefined;
    this.permissionsPolicy = loader.find(headers, "permissions-policy") ?? "";
    this.isIsolated =
      this.parent?.isIsolated ??
      (this.embedderPolicy !== "" && loader.find(headers, "cross-origin-opener-policy") === "same-origin");
  }

  get encodingOfFrames(): string | undefined {
    const encoding = this.#response?.encoding;
    return encoding?.startsWith("utf-16") ? undefined : encoding;
  }

  /** The first document of a window leaves its global object to the next one of the same origin. */
  renew(next: Page, options: any) {
    if (!this.isInitial || !this.agent || !this.controller || next.originKey !== this.originKey) return false;
    this.url = this.#env.url = this.#env.dom.url = next.url;
    this.#configure(options);
    Object.assign(this.#env.dom, this.#aboutDocument());
    this.#env.javascript = this.#runsScripts();
    this.controller.renew(this.url, this.#baseUrl);
    this.worlds.$forEach(world => world.documentChanged());
    this.#applyPolicy();
    this.followLinks(this.#response && loader.find(this.#response.headers, "link"));
    return true;
  }

  #aboutDocument() {
    const lastModified = this.#response && loader.find(this.#response.headers, "last-modified");
    const refresh = this.#response && loader.find(this.#response.headers, "refresh");
    const loadsAtTop = /(?:^|,)\s*force-load-at-top\s*(?:=\s*\?1\s*)?(?:[,;]|$)/.test(
      (this.#response && loader.find(this.#response.headers, "document-policy")) ?? "",
    );
    const { textDirectives, hasTextActivation } = this.#response ?? {};
    const language = this.#response && loader.find(this.#response.headers, "content-language")?.split(",")[0].trim();
    return {
      refresh,
      referrer: this.referrer,
      encoding: this.#response?.encoding,
      contentType: this.#response?.essence,
      lastModified,
      language,
      loadsAtTop,
      textDirectives,
      hasTextActivation,
    };
  }

  allowsEmbedder(headers: string[][]) {
    const ancestors = this.ancestors();
    if (ancestors.length === 0) return true;
    if (!this.csp.allowsAncestors(ancestors)) return false;
    if (this.csp.has("frame-ancestors")) return true;
    const options = new Set(mime.split(loader.find(headers, "x-frame-options")?.toLowerCase() ?? ""));
    if (options.$size > 1) return !["deny", "allowall", "sameorigin"].some(it => options.$has(it));
    return !options.$has("deny") && (!options.$has("sameorigin") || ancestors.every(it => it === this.origin));
  }

  isActive(): boolean {
    return !this.disposed && (this.parent?.isActive() ?? true);
  }

  setInitialUrl(url: string) {
    this.url = url;
    this.controller?.setUrl(url);
  }

  /** What `Permissions-Policy` says, if it mentions the feature. */
  #headerAllows(name: string, page: Page): boolean | undefined {
    const value = mime
      .split(this.permissionsPolicy)
      .findLast(it => it.split("=")[0] === name)
      ?.slice(name.length + 1);
    return value
      ?.split(";")[0]
      .replace(parentheses, "")
      .split(" ")
      .some(item => {
        if (item === "self") return page.originKey === this.originKey;
        return item === "*" || (item[0] === '"' && policy.originOf(item.slice(1, -1)) === page.origin);
      });
  }

  allowsFeature(name: string): boolean {
    const { parent } = this;
    if (this.#headerAllows(name, this) === false) return false;
    if (parent === undefined) return true;
    if (!parent.allowsFeature(name) || parent.#headerAllows(name, this) === false) return false;
    const { allow, source } = this.#declared;
    const listed = allow
      .split(";")
      .map(it => it.trim().split(/\s+/))
      .find(it => it[0] === name);
    if (listed === undefined) return allowedToAll.test(name) || parent.originKey === this.originKey;
    const isIt = (item: string) => {
      if (item === "'self'") return parent.originKey === this.originKey;
      return item === "*" || policy.originOf(item === "'src'" ? source : item) === this.origin;
    };
    return (listed.length > 1 ? listed.slice(1) : ["'src'"]).some(isIt);
  }

  #runsScripts() {
    return (
      this.#preferences.javascript !== false && this.csp.allowsScripts() && this.sandbox?.has("allow-scripts") !== false
    );
  }

  postMessage(source: Page, message: unknown, targetOrigin: string, transfer: object[]) {
    const { cloneInto, inbox } = this.world(0).messaging();
    const envelope = cloneInto(inbox.clone, message, transfer);
    const wanted =
      targetOrigin === "/" ? source.originKey : targetOrigin === "*" ? undefined : policy.originOf(targetOrigin);
    tasks.post(tasks.VISIBLE, () => {
      if (this.disposed || (wanted !== undefined && wanted !== this.originKey)) return;
      inbox.deliver(
        this.controller.window,
        envelope,
        source.origin,
        source.context.windowFor(this.agent),
        source.token,
      );
    });
  }

  /** What a page has if its frames and the windows that it opens are in this process. */
  #relatives() {
    const { context } = this;
    const windowOf = (it: any) => (it && !this.disposed ? it.windowFor(this.agent) : null);
    const isVisible = this.parent?.originKey === this.originKey;
    return {
      owner: this,
      container: this.#container,
      frameElement: isVisible ? this.#container.element.node : null,
      parent: () => windowOf(context.parent ?? context),
      top: () => windowOf(context.top),
      getOpener: () => windowOf(context.opener),
      disown: () => void (context.opener = null),
      getName: () => (this.disposed ? "" : context.name),
      setName: (name: string) => {
        if (!this.disposed) this.handle.name = context.name = name;
      },
      isClosed: () => context.isClosed,
      close: () => context.close(),
      allowsFeature: (name: string) => this.allowsFeature(name),
      isSandboxed: (flag: string) => this.sandbox?.has(flag) === false,
      isLocalFrame: (url: string) => policy.isTrustedInFrame(url, app.getAppPath()),
      createLocalFrame: (element: object) => this.#callbacks.createFrame(this, element),
      postMessage: (source: Page, message: unknown, origin: string, transfer: object[]) =>
        this.postMessage(source, message, origin, transfer),
      navigateFrom: (source: Page, url: string, options: object) => context.navigate(source, url, options),
      /** False if there is no such window yet. */
      isPopup: () => context.top.isPopup,
      navigateOther: (target: string, url: string | null, { becomesOpener, ...options }: any) => {
        const found = context.choose(target);
        if (found !== undefined && becomesOpener) found.opener = context;
        if (found !== undefined && url !== null) found.navigate(this, url, options);
        return found === undefined ? false : windowOf(found);
      },
    };
  }

  /** Makes this the empty document of a window that `opener` has opened. */
  adopt(opener: Page, createPage: Function) {
    this.#opener = { page: opener, createPage };
    this.origin = opener.origin;
    this.setPolicies([], opener);
    this.isInitial = false;
  }

  tellScripts(type: string, body: object, element?: object) {
    tasks.post(tasks.VISIBLE, () => this.disposed || this.worlds.$get(0)?.tellScripts?.(type, body, element));
  }

  whereNow() {
    return this.worlds.$get(0)?.whereNow?.() ?? super.whereNow();
  }

  log(level: string, message: string, line = 0, source = this.url, args?: unknown[]) {
    if (logsToStderr) console.error(`[${this.webContents.id}:${level}]`, ...(args ?? [message]), `(${source}:${line})`);
    this.#callbacks.console(this, level, message, line, source);
  }

  requestPermission = (name: string, more?: object): Promise<string> => {
    const request = this.session.requestPermission;
    if (!request) return Promise.$resolve("granted");
    return new Promise(resolve =>
      request(this.webContents, name, (granted: boolean) => resolve(granted ? "granted" : "denied"), {
        isMainFrame: this.parent === undefined,
        requestingUrl: this.url,
        ...more,
      }),
    );
  };

  #storage(kind: string) {
    if (this.origin === "null") return null;
    const store =
      kind === "local" ? this.session.storage.localStorage(this.origin) : this.#callbacks.sessionStorage(this.origin);
    const changed = (key: string | null, before: string | null, after: string | null) => {
      for (const other of started) {
        if (other === this || other.origin !== this.origin || other.session !== this.session) continue;
        if (kind !== "local" && other.context.top !== this.context.top) continue;
        queueTask(() => other.disposed || other.controller.storageChanged(kind, key, before, after, this.url));
      }
    };
    const set = (key: string, value: string | null) => {
      const before = store.get(key);
      if (!store.fits(key, value)) return false;
      if (store.set(key, value)) changed(key, before, value);
    };
    return {
      keys: () => store.keys(),
      get: (key: string) => store.get(key),
      set,
      remove: (key: string) => set(key, null),
      clear: () => void (store.clear() && changed(null, null, null)),
    };
  }

  #environment = () => {
    const state = this.#callbacks.state();
    const window = state.window();
    const { nativeTheme, screen, systemPreferences } = system();
    const windowBounds = window?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    const { colorScheme, reducedMotion, focused } = state.emulation;
    const { accent, overlayScrollbars } = require("internal/desktop/system").settings();
    const isOccluded =
      this.#preferences.backgroundThrottling !== false && !!window?.[require("internal/desktop/window").kIsOccluded]();
    return {
      dark: colorScheme ? colorScheme === "dark" : nativeTheme.shouldUseDarkColors,
      reducedMotion: reducedMotion
        ? reducedMotion === "reduce"
        : systemPreferences.getAnimationSettings().prefersReducedMotion,
      reducedTransparency: nativeTheme.prefersReducedTransparency,
      moreContrast: nativeTheme.shouldUseHighContrastColors,
      screen: screen.getDisplayMatching(windowBounds),
      zoom: this.webContents.getZoomFactor(),
      active: focused || !!window?.isFocused(),
      visible: focused || (state.isVisible() && !isOccluded),
      accent,
      overlayScrollbars,
      fullscreen: !!window?.isFullScreen(),
      transparent: state.type !== "window" || !!this.#preferences.transparent,
      titlebarArea: state.view?.titlebarArea(),
      windowBounds,
      languages: languages(this.session),
    };
  };

  #domHost() {
    const callbacks = this.#callbacks;
    const { webContents } = this;
    const state = callbacks.state();
    const dialog = require("internal/desktop/dialog");
    const later = (name: string, ...args: unknown[]) =>
      queueTask(() => this.disposed || webContents.emit(name, new Event(), ...args));
    return {
      native,
      surface: state.guest ? 0 : state.surface,
      url: this.url,
      origin: this.origin,
      ...this.#aboutDocument(),
      referrerPolicyChanged: (value: string) =>
        (this.referrerPolicy = loader.parseReferrerPolicy(value) || this.referrerPolicy),
      userAgent: webContents.getUserAgent(),
      chromeVersion: CHROME_VERSION,
      name: this.handle.name,
      opener: this.#opener?.page.controller.window,
      loadsImages: this.#preferences.images !== false,
      historyEntries: state.history.entries,
      historyLength: state.history.length,
      activation: state.history.activation,
      inboundTransition: () => this.inboundTransition,
      restoresScroll: () => this.restoresScroll,
      isInitial: () => this.isInitial,
      opened: () => {
        this.isInitial = false;
        callbacks.opened(this);
      },
      isActive: () => this.isActive(),
      isSameSite: policy.isSameSite,
      ancestorOrigins: () => this.ancestors(),
      cancelNavigation: callbacks.cancelNavigation,
      mayUnload: callbacks.mayUnload,
      traverseTo: (key: string, fail: Function) => queueTask(() => this.disposed || state.history.goTo(key, fail)),
      ping: (url: string | null, target: string) => {
        if (url === null || !url.startsWith("http")) return;
        const from =
          policy.originOf(url) === this.origin || !this.url.startsWith("https:") ? [["ping-from", this.url]] : [];
        const headers = [["content-type", "text/ping"]];
        const trustedHeaders = [...from, ["ping-to", target]];
        const options = {
          method: "POST",
          mode: "no-cors",
          credentials: "include",
          destination: "",
          initiator: "ping",
          referrer: "",
        };
        this.load({
          ...options,
          url,
          headers,
          trustedHeaders,
          body: Buffer.from("PING"),
          keepalive: true,
        }).promise.catch(() => {});
      },
      fetchResource: this.fetchResource,
      canPreload,
      contentSecurityPolicy: (text: string) => {
        this.csp.add(text, true, true, !this.#cameWith("\0" + text));
        this.#applyPolicy();
      },
      needsSource: () => compiled.isExclusive || !this.csp.restrictsScripts(),
      hasPolicyFromHeader: () => this.csp.isFromHeader,
      allowsInlineImages: () => this.csp.allowsInlineImages(),
      allowsBase: (url: string) => this.csp.allowsFor("base-uri", url),
      allowsForm: (url: string) => this.csp.allowsFor("form-action", url),
      allowsInline: (kind: string, text: string, nonce: string, isAttribute: boolean, element?: object) =>
        this.#allowsInline(kind, text, isAttribute ? "attribute" : "element", { nonce, element }),
      createRemoteFrame: (element: object) => require("internal/desktop/webview/frames").create(this, state, element),
      navigate: (url: string, options: object = {}) => callbacks.navigate(this, url, options),
      historyChanged: (url: string, how: object) => callbacks.historyChanged(this, url, how),
      traverse: (delta: number) => state.history.go(delta, this),
      reload: () => queueTask(() => this.disposed || state.reload()),
      stop: () => state.stop(),
      open: (url: string, target: string, features: string, createPage: Function, options?: object) => {
        const guest = callbacks.open(this, url, target, features, createPage, options);
        return guest && this.#handleTo(guest, url, target);
      },
      close: () =>
        queueTask(() => (state.type === "window" && state.window() ? state.window().close() : webContents.close())),
      titleChanged: (title: string) => callbacks.titleChanged(this, title),
      faviconChanged: (urls: string[]) => later("page-favicon-updated", [...urls]),
      themeColorChanged: (color: string | null) => later("did-change-theme-color", color),
      targetUrlChanged: (url: string) => later("update-target-url", url),
      checksSpelling:
        process.platform === "darwin" && this.#preferences.spellcheck !== false
          ? () => this.webContents.session.spellCheckerEnabled
          : undefined,
      contextMenu: (params: object) =>
        later("context-menu", {
          linkURL: "",
          linkText: "",
          srcURL: "",
          mediaType: "none",
          hasImageContents: false,
          isEditable: false,
          selectionText: "",
          titleText: "",
          altText: "",
          suggestedFilename: "",
          selectionRect: { x: 0, y: 0, width: 0, height: 0 },
          selectionStartOffset: 0,
          misspelledWord: "",
          dictionarySuggestions: [],
          frameCharset: "UTF-8",
          formControlType: "none",
          spellcheckEnabled: false,
          menuSourceType: "mouse",
          mediaFlags: {},
          editFlags: {},
          ...structuredClone(params),
          frame: this.handle,
          pageURL: this.url,
          frameURL: "",
          referrerPolicy: { url: "", policy: "default" },
        }),
      beforeInput: callbacks.beforeInput,
      unhandledKey: (event: object) => state.ignoresMenuShortcuts || state.window()?.handleShortcut(event),
      storage: (kind: string) => this.#storage(kind),
      cookie: {
        get: () => this.#cookies(),
        set: (text: string) =>
          this.session.jar.receive(text, new URL(this.url), { ...this.cookieContext(this.url), forScript: true }),
      },
      clipboard: system().clipboard,
      pickFiles: async ({ multiple, directory, accept = [] }: any) => {
        const extensions = [...accept].filter(it => it[0] === ".").map(it => it.slice(1));
        const { filePaths } = await dialog.showOpenDialog(state.window(), {
          title: directory ? "Select Folder to Upload" : multiple ? "Open Files" : "Open File",
          properties: [directory ? "openDirectory" : "openFile", ...(multiple ? ["multiSelections"] : [])],
          filters:
            extensions.length > 0 && extensions.length === accept.length ? [{ name: "Custom Files", extensions }] : [],
        });
        return filePaths;
      },
      permission: this.requestPermission,
      dialog: (kind: string, message: string, initial: string) => {
        const answered = callbacks.notify("dialog", kind, message, initial);
        if (answered !== undefined) return answered;
        if (kind === "prompt") throw new Error("prompt() is not supported.");
        if (this.#preferences.disableDialogs) return false;
        const buttons = kind === "confirm" ? ["OK", "Cancel"] : ["OK"];
        return dialog.showMessageBoxSync(state.window(), { message, buttons, cancelId: buttons.length - 1 }) === 0;
      },
      print: async (baseUrl: string, markup: () => string) => {
        if (this.sandbox?.has("allow-modals") !== false)
          await require("internal/desktop/webview/print").print(this, baseUrl, markup());
      },
      fullscreen: (on: boolean) => {
        state.window()?.setFullScreen(on);
        const name = `${on ? "enter" : "leave"}-html-full-screen`;
        later(name);
        state.window()?.emit(name);
      },
      isOnline: () => require("internal/desktop/electron/session").isOnline(),
      focusWindow: () => state.window()?.focus(),
      moveWindow: (bounds: object) => {
        const event = new Event();
        webContents.emit("content-bounds-updated", event, { ...bounds });
        if (!event.defaultPrevented && state.type === "window") state.window()?.setBounds({ ...bounds });
      },
      environment: this.#environment,
      allowsSpeculation: () => this.csp.isEmpty(),
      loaded: (stage: string) => callbacks.loaded(this, stage),
      crashed: () => queueTask(() => this.disposed || callbacks.crashed()),
      firstPaint: () => later("ready-to-show"),
      tasks,
    };
  }

  /** What `window.open()` returns. */
  #handleTo(guest: any, url: string, name: string) {
    const { pageOf, kPrivate } = require("internal/desktop/electron/web_contents");
    const page: Page = pageOf(guest);
    const { guest: remote } = guest[kPrivate];
    if (page.#opener) return page.controller.window;
    const { agent } = this;
    if (!remote && agent && page.context.opener === this.context) return page.context.windowFor(agent);
    return this.controller.remoteWindow({
      connect: (element: object) => {
        if (!remote?.isOpenedByPage) return;
        const controls = require("internal/desktop/webview/frames").create(this, this.#callbacks.state(), element);
        controls.openPopup(remote, url, name);
        return controls;
      },
      isClosed: () => guest.isDestroyed(),
      close: () => queueTask(() => guest.close()),
      focus: () => guest.isDestroyed() || guest.getOwnerBrowserWindow()?.focus(),
    });
  }

  /** Null if the document may not have any. */
  #cookies() {
    if (this.origin === "null") return null;
    const { jar } = this.session;
    const [all, last] = [jar.all(), this.#lastCookies];
    if (last.all !== all || last.url !== this.url) {
      last.text = jar.header(new URL(this.url), { ...this.cookieContext(this.url), forScript: true });
      last.all = all;
      last.url = this.url;
    }
    return last.text;
  }

  #allowsInline(kind: string, text: string, place: string, details?: object) {
    if (!this.csp.allowsInline(kind, text, place, details)) return false;
    // Without a policy: what the document came with, and nothing that was put into it since.
    const isUpToPage = !compiled.isExclusive && (this.csp.restrictsScripts() || policy.trustsInjectedScripts());
    if (kind !== "script" || isUpToPage || this.#cameWith(text)) return true;
    this.log("error", "Refused to run an inline script that is not in the source of the document");
    return false;
  }

  #cameWith(script: string): boolean {
    if (this.#opener) return this.#opener.page.#cameWith(script);
    return this.controller.cameWith(script) === true;
  }

  #applyPolicy() {
    const main = this.worlds.$get(0);
    if (!this.csp.allowsEval() || compiled.isExclusive) main?.disableEval();
    if (!this.csp.allowsWebAssembly()) main?.disableWebAssembly();
    if (this.csp.restrictsStyleAttributes()) this.controller?.checkStyleAttributes();
    const { csp } = this;
    if (csp.watchesEval()) main?.watchEval(csp.requiresTrustedTypes());
    if (this.csp.restrictsScripts() && !compiled.isExclusive) this.controller?.forgetSource();
  }

  #sharedEnv() {
    const { session } = this;
    const about = this.about();
    const start = performance.timeOrigin + performance.now();
    return {
      ...about,
      ...require("internal/desktop/electron/worker_thread").ofThread(),
      ...this.services(),
      loadSync: (options: object, timeout: number) => Page.block(this.loadWhole(options, timeout)),
      navigationTiming: () =>
        this.#response?.timingRecord ?? { ...timingOf(this.url, "", { internal: { headers: [] } }, 0), start },
      watchCookies: (watcher: Function) => {
        const { appliesTo } = require("internal/desktop/electron/cookies");
        const watch = (cookie: any, removed: boolean, cause: string) =>
          cause === "overwrite" || cookie.httpOnly || !appliesTo(cookie, new URL(this.url)) || watcher(cookie, removed);
        session.jar.watchers.add(watch);
        this.cleanups.$add(() => session.jar.watchers.delete(watch));
      },
      wantsConsole: () =>
        logsToStderr ||
        this.webContents.listenerCount("console-message") > 0 ||
        this.#callbacks.state().observers.size > 0,
      console: (level: string, message: string, line: number, source: string, type: string, args: unknown[]) => {
        this.#callbacks.notify("console", type, args);
        this.log(level, message, line, source, args);
      },
      uncaught: (message: string, source: string, line: number, column: number, error: any) => {
        this.#callbacks.notify("exception", message, source, line, column, error);
        this.log("error", message, line, source, [message, error?.stack ?? ""]);
      },
      indexedDB: (name: string) => session.storage.indexedDB(about.bucket, name),
      indexedDatabases: () => session.storage.indexedDatabases(about.bucket),
    };
  }

  #preloadEnv(contextIsolated: boolean, isSandboxed: boolean) {
    const callbacks = this.#callbacks;
    const { webContents } = this;
    const { EventTarget, Blob, Event } = this.controller.window;
    const methods = {};
    for (const name of [
      "getBlinkMemoryInfo",
      "getCPUUsage",
      "getCreationTime",
      "getHeapStatistics",
      "getProcessMemoryInfo",
      "getSystemMemoryInfo",
      "getSystemVersion",
    ]) {
      methods[name] = () => process[name]();
    }
    const about = {
      type: "renderer",
      argv: [process.execPath, "--type=renderer", ...(this.#preferences.additionalArguments ?? [])],
      contextIsolated,
      sandboxed: isSandboxed || undefined,
      isMainFrame: true,
      contextId: `${webContents.id}-${this.id}`,
    };
    const { arch, platform, pid, execPath, version, versions, env } = process;
    return {
      contextIsolated,
      nodeIntegration: !!this.#preferences.nodeIntegration,
      documentPath: this.url.startsWith("file:")
        ? Bun.fileURLToPath(this.url)
        : path.join(app.getAppPath(), "index.html"),
      originOf: policy.originOf,
      link: {
        back: null,
        isShared: (value: object) => value instanceof EventTarget || value instanceof Blob || value instanceof Event,
      },
      process: { arch, platform, pid, execPath, version, versions: { ...versions }, env: { ...env }, ...about },
      processMethods: methods,
      pathForFile: (file: object) => paths.get(file) ?? "",
      get nativeImage() {
        return system().nativeImage;
      },
      unsandboxed: !isSandboxed && {
        process: Object.create(process, Object.getOwnPropertyDescriptors(about)),
        createRequire: require("node:module").createRequire,
        dirname: path.dirname,
        electron: { shell: system().shell, clipboard: require("internal/desktop/electron/system").clipboard },
      },
      ipc: {
        send: (channel: string, args: unknown[]) => queueTask(callbacks.send, this, channel, structuredClone(args)),
        sendSync: (channel: string, args: unknown[]) => callbacks.sendSync(this, channel, structuredClone(args)),
        postMessage: (channel: string, message: unknown, transfer: MessagePort[]) => {
          const { isPort, release } = this.worlds.$get(0).messaging();
          transfer = Array.from(transfer, port => (isPort(port) ? release(port) : port));
          const [data, ports] = structuredClone([message, transfer], { transfer });
          queueTask(callbacks.send, this, channel, [data], ports);
        },
        invoke: (channel: string, args: unknown[], reply: Function) =>
          queueTask(this.#invoke, channel, structuredClone(args), reply),
      },
      frame: {
        routingId: this.id,
        frameToken: this.token,
        executeJavaScript: (world: number, code: string) => this.executeJavaScript(world, code),
        insertCSS: (css: string) => this.controller.insertCSS(css),
        removeInsertedCSS: (key: string) => this.controller.removeInsertedCSS(key),
        insertText: (text: string) => this.controller.insertText(text),
        getZoomFactor: () => webContents.getZoomFactor(),
        setZoomFactor: (factor: number) => webContents.setZoomFactor(factor),
        getZoomLevel: () => webContents.getZoomLevel(),
        setZoomLevel: (level: number) => webContents.setZoomLevel(level),
      },
    };
  }

  #invoke = async (channel: string, args: unknown[], reply: Function) => {
    let error: string | undefined;
    let result: unknown;
    try {
      result = await this.#callbacks.invoke(this, channel, args);
      if (this.disposed) return;
      result = this.#preloadWorld.clone(result);
    } catch (thrown: any) {
      console.error(`Error occurred in handler for '${channel}':`, thrown);
      error = thrown?.name === "DataCloneError" ? "Error: An object could not be cloned." : String(thrown);
    }
    tasks.post(tasks.VISIBLE, () => this.disposed || reply(error, result));
  };

  send(channel: string, args: unknown[], ports: MessagePort[]) {
    if (this.disposed || !this.#preload) return;
    const copied = this.#preloadWorld.clone([args, ports], ports.length > 0 ? ports : undefined);
    tasks.post(tasks.VISIBLE, () => {
      if (this.disposed) return;
      try {
        this.#preload.receive(
          channel,
          copied[0],
          ports.length > 0 ? Array.from(copied[1], this.worlds.$get(0).messaging().adopt) : copied[1],
        );
      } catch (error) {
        this.worlds.$get(0).report(error);
      }
    });
  }

  /** No script of a page runs until `promise` is fulfilled. */
  static block(promise: Promise<unknown>) {
    const pause = (isPaused: boolean) => {
      for (const page of started) page.worlds.$forEach(world => world.setPaused(isPaused));
    };
    return require("internal/desktop/web/blocking").block(promise, pause);
  }

  world(id: number) {
    let world = this.worlds.$get(id);
    if (!world && this.#opener) this.worlds.$set(id, (world = this.#borrowedWorld()));
    if (!world) this.worlds.$set(id, (world = createRealm().isolated(this.#env, this.worlds.$get(0))));
    return world;
  }

  /** The realm of the opener, in which names are looked up in this window first. */
  #borrowedWorld() {
    const owner = this.#opener!.page.world(0);
    const { window } = this.controller;
    const run = owner.evaluate("(function(){with(this)return eval(arguments[0])})", "");
    const evaluate = (code: string) => owner.withEval(() => run.$call(window, code));
    return { ...owner, global: window, evaluate, dispose() {} };
  }

  async executeJavaScript(world: number, code: string) {
    if (this.disposed || !this.controller)
      throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    let result;
    try {
      result = this.world(world).evaluate(code, "");
    } catch (error) {
      this.world(0).report(error);
      throw new Error(
        "Script failed to execute, this normally means an error was thrown. Check the renderer console for the error.",
      );
    }
    return structuredClone(await Promise.$resolve(result).catch(error => Promise.$reject(structuredClone(error))));
  }

  /** Makes the realm and the empty document, and runs the preload scripts. */
  start() {
    started.$add(this);
    const preferences = this.#preferences;
    const dom = this.#domHost();
    if (this.#opener) {
      const { reportError, messaging, fileFromPath, createPlayer, describeError } =
        this.#opener.page.controller.page.host;
      this.controller = this.#opener.createPage({
        __proto__: this.#opener.page.world(0).guard(dom),
        reportError,
        messaging,
        fileFromPath,
        createPlayer,
        describeError,
      });
      return;
    }
    let window;
    if (policy.hasLocalFrames()) {
      [this.agent, window] = this.context.join(this);
      const relatives: any = this.#relatives();
      // The windows that pages open are not among them.
      if (!policy.trustsFrames()) {
        const { navigateOther } = relatives;
        for (const name of aboutOpenedWindows) delete relatives[name];
        if (this.parent) {
          relatives.close = () => {};
          relatives.navigateOther = (target: string, ...rest: unknown[]) =>
            /^_(?:self|parent|top)$/i.test(target) && navigateOther(target, ...rest);
        }
      }
      Object.assign(dom, relatives);
    }
    const preloads =
      this.parent && !preferences.nodeIntegrationInSubFrames
        ? []
        : [...this.webContents.session.getPreloads(), preferences.preload ?? []].flat();
    const contextIsolated = preferences.contextIsolation !== false;
    const hasPreload = preloads.length > 0 || (preferences.nodeIntegration && !this.parent);
    const main = createRealm(window).page(
      (this.#env = {
        ...this.#sharedEnv(),
        dom,
        isOfHost: (value: unknown) => value instanceof Object,
        shared: this.agent?.root?.controller.shared(),
        baseUrl: this.#baseUrl,
        javascript: this.#runsScripts(),
        sharesWorldWithPreload: hasPreload && !contextIsolated,
        allowsInlineScript: (source: string, place: string, details?: object, initiator: Page = this) =>
          initiator.#allowsInline("script", source, place, details),
        readFile(file: string) {
          const type = Bun.file(file).type.split(";")[0];
          const stat = fs.statSync(file);
          return {
            bytes: stat.isFile() ? fs.readFileSync(file) : new Uint8Array(),
            isDirectory: stat.isDirectory(),
            name: path.basename(file),
            type: type === "application/octet-stream" ? "" : type,
            lastModified: Math.floor(stat.mtimeMs),
          };
        },
        connectMedia: (listener: object) => require("internal/desktop/webview/media").connect(listener),
        requestMicrophone: async () =>
          this.allowsFeature("microphone")
            ? this.requestPermission("media", { mediaTypes: ["audio"], securityOrigin: this.origin + "/" })
            : "denied",
        rememberPath: (file: object, where: string) => paths.set(file, where),
        notify: (title: string, body: string, silent: boolean, fire: (type: string) => void) => {
          const notification = new (system().Notification)({ title, body, silent });
          for (const type of ["click", "show", "close"])
            notification.on(type, () => queueTask(() => this.disposed || fire(type)));
          notification.show();
          return notification;
        },
      }),
    );
    this.worlds.$set(0, main);
    const { agent } = this;
    if (agent) this.context.joined(agent, main);
    this.controller = main.controller;
    this.#applyPolicy();
    this.followLinks(this.#response && loader.find(this.#response.headers, "link"));
    if (!hasPreload) return;

    const world = (this.#preloadWorld = contextIsolated ? this.world(PRELOAD_WORLD) : main);
    const isSandboxed = preferences.sandbox ?? !preferences.nodeIntegration;
    this.#preload = world.preload.create(this.#preloadEnv(contextIsolated, isSandboxed), (id: number) =>
      this.world(id),
    );
    for (const file of preloads) {
      try {
        if (!path.isAbsolute(file)) throw new Error(`Preload script must have absolute path: ${file}`);
        const { href } = Bun.pathToFileURL(file);
        const inExecutable = compiled.pathOf(href);
        const script = inExecutable
          ? world.runCompiled(inExecutable, true).default
          : world.evaluate(`(function(${PRELOAD_PARAMETERS}){${fs.readFileSync(file, "utf8")}\n})`, href);
        this.#preload.run(script, file);
      } catch (error: any) {
        console.error(`Unable to load preload script: ${file}`, error);
        this.webContents.emit(
          "preload-error",
          new Event(),
          file,
          Object.assign(new Error(error.message), { stack: error.stack }),
        );
      }
    }
    this.#preload.loaded();
  }

  dispose() {
    if (this.disposed) return;
    this.controller?.dispose();
    started.$delete(this);
    super.dispose();
    this.worlds.$forEach(world => world.dispose(world === this.agent?.root, this.agent?.pages.$size > 1));
    this.agent?.leave(this);
    this.worlds.$clear();
    this.controller = this.#preload = this.#preloadWorld = this.#env = this.#response = undefined;
  }
}

function onlineChanged(is: boolean) {
  started.$forEach(page => queueTask(() => page.disposed || page.controller.onlineChanged(is)));
}

export default { Page, onlineChanged };
