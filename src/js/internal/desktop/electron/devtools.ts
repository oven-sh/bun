// The part of the Chrome DevTools Protocol that automation tools need.
const native = require("internal/desktop/native");
const { app } = require("internal/desktop/app");
const { kPrivate, webContents } = require("internal/desktop/electron/web_contents");

const targetIds = new WeakMap<object, string>();
const nodeIds = new WeakMap<object, number>();
const nodes = new Map<number, WeakRef<object>>();
let nextContext = 1;
let nextWorld = 1 << 20;

function targetIdOf(contents: any) {
  let id = targetIds.get(contents);
  if (!id) targetIds.set(contents, (id = crypto.randomUUID().replaceAll("-", "").toUpperCase()));
  return id;
}

function nodeIdOf(node: object) {
  let id = nodeIds.get(node);
  if (!id) {
    nodeIds.set(node, (id = nodes.$size + 1));
    nodes.$set(id, new WeakRef(node));
  }
  return id;
}

const namedKeys = {
  backspace: "Backspace",
  delete: "Delete",
  down: "ArrowDown",
  end: "End",
  enter: "Enter",
  escape: "Escape",
  home: "Home",
  insert: "Insert",
  left: "ArrowLeft",
  pagedown: "PageDown",
  pageup: "PageUp",
  right: "ArrowRight",
  tab: "Tab",
  up: "ArrowUp",
};

function describeKey(name: string, shift: boolean) {
  if (name === "space") return { key: " ", code: "Space" };
  if (/^[a-z]$/.test(name)) return { key: shift ? name.toUpperCase() : name, code: "Key" + name.toUpperCase() };
  if (/^\d$/.test(name)) return { key: name, code: "Digit" + name };
  const key = namedKeys[name] ?? name.toUpperCase();
  return { key, code: key.length > 1 ? key : "" };
}

const toModifiers = (bits = 0) => ((bits & 8) >> 3) | (bits & 2) | ((bits & 1) << 2) | ((bits & 4) << 1);
const seconds = () => performance.now() / 1000;
const lifecycleNames = { "dom-ready": "DOMContentLoaded", "load": "load" };
const ignored =
  /^(?:\w+\.(?:enable|disable)|Runtime\.(?:runIfWaitingForDebugger|discardConsoleEntries)|Target\.set(?:AutoAttach|DiscoverTargets)|Network\.(?:set\w+|emulateNetworkConditions|clearBrowserCache)|Security\.setIgnoreCertificateErrors|Page\.(?:setFontFamilies|setInterceptFileChooserDialog|setBypassCSP|setWebLifecycleState)|Emulation\.(?:setGeolocationOverride|clearGeolocationOverride|setDefaultBackgroundColorOverride|setTouchEmulationEnabled)|Input\.setInterceptDrags|Browser\.(?:setDownloadBehavior|grantPermissions|resetPermissions))$/;

type Context = { id: number; name: string; world: number };
type Emit = (method: string, params: object) => void;
type Reply = { resolve(result: any): void; reject(error: any): void };

const resourceTypes = {
  "": "Fetch",
  "audio": "Media",
  "document": "Document",
  "font": "Font",
  "iframe": "Document",
  "image": "Image",
  "script": "Script",
  "style": "Stylesheet",
  "video": "Media",
};
const networkErrors = {
  AccessDenied: "ACCESS_DENIED",
  BlockedByClient: "BLOCKED_BY_CLIENT",
  ConnectionRefused: "CONNECTION_REFUSED",
  Aborted: "ABORTED",
};
const isText = /^(?:text\/(?!event-stream)|application\/[\w.+-]*(?:json|xml|javascript))/;

/** What the loader calls instead of the hooks of `webRequest`, for one request. */
function spy(sessions: Set<PageSession>, hooks: any, destination: string | undefined) {
  const loader = require("internal/desktop/electron/loader");
  const requestId = "request." + loader.nextRequestId();
  const type = resourceTypes[destination!] ?? "Other";
  let redirectResponse: object | undefined;
  let isKnown = false;
  const emit = (method: string, params: object) =>
    sessions.$forEach(it => it.network(method, { requestId, type, ...params }));
  const describe = ({ url, statusCode: status, statusLine, responseHeaders, fromCache }: any) => {
    const headers = Object.fromEntries(
      Object.entries<string[]>(responseHeaders).map(([name, values]) => [name, values.join("\n")]),
    );
    const [mimeType] = (
      Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? ""
    ).split(";");
    return {
      url,
      status,
      statusText: statusLine.split(" ").slice(2).join(" "),
      headers,
      mimeType,
      fromDiskCache: fromCache,
      encodedDataLength: 0,
    };
  };
  return {
    ask: hooks.ask,
    listens: (name: string, url: URL) => name === "onCompleted" || hooks.listens(name, url),
    tell(name: string, url: URL, details: () => any) {
      if (name === "onBeforeRedirect") redirectResponse = describe(details());
      else if (!isKnown);
      else if (name === "onResponseStarted")
        emit("Network.responseReceived", { response: describe(details()), hasExtraInfo: false });
      else if (name === "onCompleted") emit("Network.loadingFinished", { encodedDataLength: 0 });
      else if (name === "onErrorOccurred")
        emit("Network.loadingFailed", { errorText: details().error, canceled: details().error.endsWith("ABORTED") });
      return hooks.tell(name, url, details);
    },
    async exchange(url: string, method: string, headers: Headers, body: any, send: Function) {
      const bytes = typeof body === "string" || $isTypedArrayView(body) ? Buffer.from(body) : undefined;
      const request = {
        url,
        method,
        headers: Object.fromEntries(headers),
        hasPostData: body !== null,
        postData: bytes?.toString(),
        postDataEntries: bytes && [{ bytes: bytes.toString("base64") }],
      };
      emit("Network.requestWillBeSent", {
        request,
        redirectResponse,
        redirectHasExtraInfo: false,
        initiator: { type: "other" },
        wallTime: Date.now() / 1000,
      });
      isKnown = true;
      redirectResponse = undefined;
      let response;
      for (const session of [...sessions]) {
        const answer = await session.pause(requestId, request, type);
        if (answer?.errorReason) throw loader.netError(networkErrors[answer.errorReason] ?? "FAILED");
        const given = (answer?.responseHeaders ?? answer?.headers)?.map(({ name, value }) => [name, value]);
        if (answer?.responseCode) {
          const isEmpty = [204, 205, 304].includes(answer.responseCode);
          response = new Response(isEmpty ? null : Buffer.from(answer.body ?? "", "base64"), {
            status: answer.responseCode,
            headers: given,
          });
          break;
        }
        if (given) headers = new Headers(given);
        method = answer?.method ?? method;
        if (answer?.postData !== undefined) body = Buffer.from(answer.postData, "base64");
      }
      response ??= await send(method, headers, body);
      if (response?.body && !destination && isText.test(response.headers.get("content-type") ?? "")) {
        const copy = response.clone().bytes();
        copy.catch(() => {});
        sessions.$forEach(it => it.keepBody(requestId, copy));
      }
      return response;
    },
  };
}

/** `*` is any text, `?` any character, and a backslash escapes. */
const urlPattern = (text = "*") =>
  new RegExp(
    `^${text.replace(/\\?./gs, it => (it === "*" ? ".*" : it === "?" ? "." : RegExp.escape(it.at(-1)!)))}$`,
    "s",
  );

class Input {
  #contents;
  #state;
  #touches = new Map<number, any>();

  constructor(contents: any) {
    this.#contents = contents;
    this.#state = contents[kPrivate];
  }

  #at(x: number, y: number) {
    const zoom = this.#contents.getZoomFactor();
    const origin = native.ask("surface.size", { id: this.#state.surface });
    return { x: x * zoom, y: y * zoom, sx: origin.x + x * zoom, sy: origin.y + y * zoom };
  }

  #input(event: object) {
    if (!this.#state.guest) this.#state.page();
    this.#state.input(event);
  }

  commands = {
    "Input.dispatchKeyEvent": ({ type, key = "", code = "", text, modifiers, location = 0, autoRepeat }: any) => {
      const m = toModifiers(modifiers);
      const e = type === "keyUp" ? "up" : "down";
      if (type !== "char") this.#input({ t: "key", e, key, code, location, repeat: !!autoRepeat, m, composing: false });
      if (e === "down" && text >= " " && !(m & 0b1110)) this.#input({ t: "text", text, key: type !== "char" });
    },
    "Input.dispatchTouchEvent": ({ type, touchPoints, modifiers }: any) => {
      let now = new Map<number, any>();
      for (const { id = 0, x, y, radiusX = 1, radiusY = 1, force = 1, ...details } of touchPoints) {
        now.$set(id, {
          id,
          ...this.#at(x, y),
          details: { ...details, width: radiusX * 2, height: radiusY * 2, pressure: force },
        });
      }
      const before = this.#touches;
      if (type === "touchEnd" && now.$size > 0) now = new Map([...before].filter(([id]) => !now.$has(id)));
      const send = (e: string, from: Map<number, any>, test: (point: any) => boolean) => {
        const points = [...from.values()].filter(test);
        if (points.length > 0) this.#input({ t: "touch", e, points, m: toModifiers(modifiers) });
      };
      this.#touches = now;
      send(type === "touchCancel" ? "cancel" : "end", before, it => !now.$has(it.id));
      send("move", now, it => before.$has(it.id) && !Bun.deepEquals(it, before.$get(it.id)));
      send("start", now, it => !before.$has(it.id));
    },
    "Input.dispatchMouseEvent": (params: any) => {
      const { type, x, y, button, buttons = 0, clickCount = 0, modifiers, deltaX, deltaY, pointerType } = params;
      const at = { ...this.#at(x, y), m: toModifiers(modifiers) };
      if (type === "mouseWheel")
        return this.#input({ t: "wheel", ...at, dx: deltaX, dy: deltaY, precise: true, phase: "move" });
      const e = { mousePressed: "down", mouseReleased: "up" }[type] ?? "move";
      if (e === "down") this.#contents.focus();
      const b = Math.max(["left", "middle", "right", "back", "forward"].indexOf(button), 0);
      if (pointerType !== "pen") return this.#input({ t: "mouse", e, ...at, b, buttons, n: clickCount });
      const { force: pressure, tangentialPressure, tiltX, tiltY, twist } = params;
      this.#input({
        t: "pen",
        e,
        ...at,
        b,
        buttons,
        n: clickCount,
        details: { pressure, tangentialPressure, tiltX, tiltY, twist },
      });
    },
    "Input.insertText": ({ text }: any) => this.#input({ t: "text", text, key: false }),
    "Input.imeSetComposition": ({ text, selectionStart, selectionEnd }: any) =>
      this.#input(text ? { t: "compose", text, selection: [selectionStart, selectionEnd] } : { t: "composeEnd" }),
  };
}

class PageSession {
  #contents;
  #state;
  #emit;
  #id;
  #contexts = new Map<number, Context>();
  #objects = new Map<string, { value: any; context: Context }>();
  #nextObject = 1;
  #scripts = new Map<string, { source: string; worldName?: string }>();
  #nextScript = 1;
  #bindings = new Set<string>();
  #reportsContexts = false;
  #stages: string[];
  #input: Input;
  #patterns: RegExp[] = [];
  #paused = new Map<string, (answer?: object) => void>();
  #bodies = new Map<string, Promise<Uint8Array>>();
  #reportsRequests = false;
  #metrics: object | undefined;
  /** The frames that are targets of their own. */
  children: Children | undefined;

  constructor(contents: any, emit: Emit) {
    this.#contents = contents;
    this.#state = contents[kPrivate];
    this.#emit = emit;
    this.#id = targetIdOf(contents);
    this.#input = new Input(contents);
    const { readyState } = this.#state.page().controller.document;
    this.#stages = { loading: [], interactive: ["dom-ready"] }[readyState] ?? ["dom-ready", "load"];
    this.#addContext("");
    this.#state.observers.add(this);
  }

  close() {
    this.#state.observers.delete(this);
    this.#watchRequests(false, []);
    this.children?.close();
    this.#objects.$clear();
    this.#state.emulation = {};
    this.#state.environmentChanged();
  }

  #frame() {
    const { url, origin, token } = this.#state.page();
    const [base, fragment] = url.split(/(?=#)/);
    const above = this.#state.context.parent?.state.contents;
    return {
      id: this.#id,
      parentId: above && targetIdOf(above),
      name: this.#state.context.name,
      loaderId: token,
      url: base,
      urlFragment: fragment,
      securityOrigin: origin,
      mimeType: "text/html",
    };
  }

  #describeContext({ id, name }: Context) {
    const auxData = { isDefault: name === "", type: name ? "isolated" : "default", frameId: this.#id };
    return { context: { id, name, origin: this.#state.page().origin, uniqueId: String(id), auxData } };
  }

  #addContext(name: string) {
    for (const context of this.#contexts.values()) if (context.name === name) return context;
    const context = { id: nextContext++, name, world: name ? nextWorld++ : 0 };
    this.#contexts.$set(context.id, context);
    if (this.#reportsContexts) this.#emit("Runtime.executionContextCreated", this.#describeContext(context));
    return context;
  }

  #context(id?: number) {
    const context = id === undefined ? this.#addContext("") : this.#contexts.$get(id);
    if (!context) throw new Error("Cannot find context with specified id");
    return context;
  }

  #object(id: string) {
    const object = this.#objects.$get(id);
    if (!object) throw new Error("Could not find object with given id");
    return object;
  }

  #node({ objectId, backendNodeId, nodeId }: any) {
    const node = objectId ? this.#object(objectId).value : nodes.$get(backendNodeId ?? nodeId)?.deref();
    if (!node) throw new Error("No node with given id found");
    return node;
  }

  #world(context: Context) {
    return this.#state.page().world(context.world);
  }

  #remote(value: any, context: Context, byValue?: boolean) {
    const type = typeof value;
    if (value === undefined) return { type };
    if (value === null) return { type, subtype: "null", value };
    if (type === "bigint") return { type, unserializableValue: value + "n", description: value + "n" };
    if (type === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
      const text = value === 0 ? "-0" : String(value);
      return { type, unserializableValue: text, description: text };
    }
    if (type === "number" || type === "string" || type === "boolean") return { type, value };
    if (byValue) return { type, value: type === "object" ? JSON.parse(JSON.stringify(value)) : {} };
    const objectId = String(this.#nextObject++);
    this.#objects.$set(objectId, { value, context });
    if (type !== "object") return { type, objectId, className: "Function", description: String(value) };
    const className = Object.prototype.toString.$call(value).slice(8, -1);
    const subtype =
      value instanceof this.#state.page().controller.window.Node
        ? "node"
        : /^(?:Array|Date|Error|Map|Promise|RegExp|Set)$/.test(className)
          ? className.toLowerCase()
          : undefined;
    const description =
      subtype === "error" ? `${value}\n${value.stack}` : subtype === "array" ? `Array(${value.length})` : className;
    return { type, subtype, objectId, className, description };
  }

  async #result(context: Context, { awaitPromise, returnByValue }: any, run: () => unknown) {
    try {
      let value = this.#world(context).withEval(run);
      if (awaitPromise) value = await value;
      this.#context(context.id);
      return { result: this.#remote(value, context, returnByValue) };
    } catch (error) {
      this.#context(context.id);
      const exception = this.#remote(error, context);
      return {
        result: exception,
        exceptionDetails: { exceptionId: 1, text: "Uncaught", lineNumber: 0, columnNumber: 0, exception },
      };
    }
  }

  #bind(name: string, context: Context) {
    const world = this.#world(context);
    world.global[name] = world.evaluate(
      "call => payload => call(payload)",
      "",
    )((payload: string) => this.#emit("Runtime.bindingCalled", { name, payload, executionContextId: context.id }));
  }

  #runScript({ source, worldName = "" }: { source: string; worldName?: string }) {
    const context = this.#addContext(worldName);
    try {
      if (source) this.#world(context).evaluate(source, "");
    } catch {}
  }

  #lifecycle(name: string) {
    this.#emit("Page.lifecycleEvent", {
      frameId: this.#id,
      loaderId: this.#state.page().token,
      name,
      timestamp: seconds(),
    });
  }

  documentCreated() {
    this.#objects.$clear();
    this.#contexts.$clear();
    this.#stages = [];
    this.#emit("Runtime.executionContextsCleared", {});
    this.#emit("Page.frameNavigated", { frame: this.#frame(), type: "Navigation" });
    this.#lifecycle("init");
    this.children?.update();
    const context = this.#addContext("");
    for (const name of this.#bindings) this.#bind(name, context);
    for (const script of this.#scripts.values()) this.#runScript(script);
  }

  navigatedWithinDocument(url: string) {
    this.#emit("Page.navigatedWithinDocument", { frameId: this.#id, url, navigationType: "historyApi" });
  }

  lifecycle(stage: string) {
    this.#stages.push(stage);
    this.#lifecycle(lifecycleNames[stage]);
    this.#emit(stage === "load" ? "Page.loadEventFired" : "Page.domContentEventFired", { timestamp: seconds() });
  }

  console(type: string, args: unknown[]) {
    if (!this.#reportsContexts) return;
    const context = this.#addContext("");
    const remote = args.map(value => this.#remote(value, context));
    this.#emit("Runtime.consoleAPICalled", {
      type,
      args: remote,
      executionContextId: context.id,
      timestamp: Date.now(),
    });
  }

  exception(text: string, url: string, lineNumber: number, columnNumber: number, error: unknown) {
    if (!this.#reportsContexts) return;
    const exception = this.#remote(error, this.#addContext(""));
    const exceptionDetails = { exceptionId: 1, text, url, lineNumber, columnNumber, exception };
    this.#emit("Runtime.exceptionThrown", { timestamp: Date.now(), exceptionDetails });
  }

  dialog(): unknown {
    return;
  }

  framesChanged() {
    this.children?.update();
  }

  #watchRequests(reports: boolean, patterns: RegExp[]) {
    this.#reportsRequests = reports;
    this.#patterns = patterns;
    if (patterns.length === 0) this.#paused.$forEach(resume => resume());
    if (reports || patterns.length > 0) (this.#state.network ??= new Set()).add(this);
    else if (this.#state.network?.delete(this) && this.#state.network.size === 0) this.#state.network = undefined;
  }

  network(method: string, params: object) {
    if (!this.#reportsRequests) return;
    const { token: loaderId, url: documentURL } = this.#state.pageAsItIs();
    this.#emit(method, { frameId: this.#id, loaderId, documentURL, timestamp: seconds(), ...params });
  }

  pause(networkId: string, request: { url: string }, resourceType: string): Promise<any> | undefined {
    if (request.url.startsWith("data:") || !this.#patterns.some(it => it.test(request.url))) return;
    const { promise, resolve } = Promise.withResolvers();
    const requestId = "paused." + this.#nextObject++;
    this.#paused.$set(requestId, resolve);
    this.#emit("Fetch.requestPaused", { requestId, networkId, request, resourceType, frameId: this.#id });
    return promise.finally(() => this.#paused.$delete(requestId));
  }

  keepBody(requestId: string, bytes: Promise<Uint8Array>) {
    this.#bodies.$set(requestId, bytes);
    if (this.#bodies.$size > 200) this.#bodies.$delete(this.#bodies.keys().next().value!);
  }

  #resume = (params: any) => {
    const resume = this.#paused.$get(params.requestId);
    if (!resume) throw new Error("Invalid InterceptionId.");
    resume(params);
  };

  #commands = {
    "Accessibility.getPartialAXTree": (params: any) => {
      const { role, name } = this.#state.page().controller.describeForAccessibility(this.#node(params));
      const value = (type: string, value: string) => ({ type, value });
      return {
        nodes: [
          { nodeId: "1", ignored: role === "none", role: value("role", role), name: value("computedString", name) },
        ],
      };
    },
    "DOM.describeNode": (params: any) => {
      const node = this.#node(params);
      const { nodeType, nodeName, localName = "", nodeValue } = node;
      const frameId = node === node.ownerDocument?.documentElement ? this.#id : this.children?.idOf(node);
      return {
        node: {
          nodeId: 0,
          backendNodeId: nodeIdOf(node),
          nodeType,
          nodeName,
          localName,
          nodeValue: nodeValue ?? "",
          frameId,
        },
      };
    },
    "DOM.getFrameOwner": ({ frameId }: any) => {
      const owner = this.children?.ownerOf(frameId);
      if (!owner) throw new Error("Frame with the given id was not found.");
      return { backendNodeId: nodeIdOf(owner) };
    },
    "DOM.setFileInputFiles": (params: any) =>
      this.#state.page().controller.chooseFiles(this.#node(params), params.files),
    "Emulation.setDeviceMetricsOverride": ({ width, height, deviceScaleFactor }: any) => {
      const real: any = (this.#metrics ??= this.#state.size());
      this.#state.input({
        ...real,
        t: "resize",
        width: width || real.width,
        height: height || real.height,
        scale: deviceScaleFactor || real.scale,
      });
    },
    "Emulation.clearDeviceMetricsOverride": () => {
      if (this.#metrics) this.#state.input(this.#metrics);
      this.#metrics = undefined;
    },
    "Fetch.enable": ({ patterns = [{}] }: any) =>
      this.#watchRequests(
        this.#reportsRequests,
        patterns.map(it => urlPattern(it.urlPattern)),
      ),
    "Fetch.disable": () => this.#watchRequests(this.#reportsRequests, []),
    "Fetch.continueRequest": this.#resume,
    "Fetch.failRequest": this.#resume,
    "Fetch.fulfillRequest": this.#resume,
    "Network.enable": () => this.#watchRequests(true, this.#patterns),
    "Network.disable": () => this.#watchRequests(false, this.#patterns),
    "Network.loadNetworkResource": async ({ url, options }: any) => {
      try {
        const response = await this.#contents.session.fetch(url, {
          credentials: options.includeCredentials ? "include" : "omit",
        });
        response.body?.cancel();
        return {
          resource: {
            success: response.ok,
            httpStatusCode: response.status,
            headers: Object.fromEntries(response.headers),
          },
        };
      } catch (error: any) {
        return { resource: { success: false, netErrorName: error.message } };
      }
    },
    "Network.getResponseBody": async ({ requestId }: any) => {
      const bytes = await this.#bodies.$get(requestId);
      if (!bytes) throw new Error("No resource with given identifier found");
      return { body: bytes.toBase64(), base64Encoded: true };
    },
    "Target.setAutoAttach": ({ autoAttach }: any) => autoAttach && this.children?.start(),
    "DOM.resolveNode": (params: any) => ({
      object: this.#remote(this.#node(params), this.#context(params.executionContextId)),
    }),
    "DOM.getContentQuads": (params: any) => {
      let node = this.#node(params);
      if (node.nodeType === 3) {
        const range = node.ownerDocument.createRange();
        range.selectNodeContents(node);
        node = range;
      }
      const rectangles = Array.from<any>(node.getClientRects());
      return { quads: rectangles.map(({ left: l, top: t, right: r, bottom: b }) => [l, t, r, t, r, b, l, b]) };
    },
    "DOM.getBoxModel": (params: any) => {
      const { left: l, top: t, right: r, bottom: b, width, height } = this.#node(params).getBoundingClientRect();
      const quad = [l, t, r, t, r, b, l, b];
      return { model: { content: quad, padding: quad, border: quad, margin: quad, width, height } };
    },
    "DOM.scrollIntoViewIfNeeded": (params: any) => {
      let node = this.#node(params);
      if (!node.isConnected) throw new Error("Node is detached from document");
      if (node.nodeType !== 1) node = node.parentElement;
      if (node.getClientRects().length === 0) throw new Error("Node does not have a layout object");
      node.scrollIntoViewIfNeeded(true);
    },
    "DOM.focus": (params: any) => this.#node(params).focus(),
    "Emulation.setEmulatedMedia": ({ features = [] }: any) => {
      const value = (name: string) => features.find(feature => feature.name === name)?.value;
      Object.assign(this.#state.emulation, {
        colorScheme: value("prefers-color-scheme"),
        reducedMotion: value("prefers-reduced-motion"),
      });
      this.#state.environmentChanged();
    },
    "Emulation.setFocusEmulationEnabled": ({ enabled }: any) => {
      this.#state.emulation.focused = enabled;
      this.#state.environmentChanged();
      if (enabled) this.#state.page().controller.handleEvent({ t: "focus", s: this.#state.surface });
    },
    "Emulation.setUserAgentOverride": ({ userAgent }: any) => this.#contents.setUserAgent(userAgent),
    "HeapProfiler.collectGarbage": () => void Bun.gc(true),
    "HeapProfiler.takeHeapSnapshot": () => {
      const snapshot = Bun.generateHeapSnapshot("v8");
      for (let at = 0; at < snapshot.length; at += 1 << 20) {
        this.#emit("HeapProfiler.addHeapSnapshotChunk", { chunk: snapshot.slice(at, at + (1 << 20)) });
      }
    },
    "Page.addScriptToEvaluateOnNewDocument": (params: any) => {
      const identifier = String(this.#nextScript++);
      this.#scripts.$set(identifier, params);
      if (params.runImmediately) this.#runScript(params);
      return { identifier };
    },
    "Page.removeScriptToEvaluateOnNewDocument": ({ identifier }: any) => void this.#scripts.$delete(identifier),
    "Page.bringToFront": () => {
      this.#state.window()?.focus();
      this.#contents.focus();
    },
    "Page.captureScreenshot": async ({ format, quality = 80, clip }: any) => {
      const { scrollX, scrollY } = this.#state.page().controller.window;
      const zoom = this.#contents.getZoomFactor();
      const rectangle = clip && {
        x: (clip.x - scrollX) * zoom,
        y: (clip.y - scrollY) * zoom,
        width: clip.width * zoom,
        height: clip.height * zoom,
      };
      const image = await this.#contents.capturePage(rectangle);
      return { data: (format === "jpeg" ? image.toJPEG(quality) : image.toPNG()).toString("base64") };
    },
    "Page.close": () => void setImmediate(() => this.#contents.close()),
    "Page.createIsolatedWorld": ({ worldName }: any) => ({
      executionContextId: this.#addContext(worldName || "isolated").id,
    }),
    "Page.getFrameTree": () => ({ frameTree: { frame: this.#frame() } }),
    "Page.getLayoutMetrics": () => {
      const { innerWidth, innerHeight, scrollX, scrollY, document } = this.#state.page().controller.window;
      const layout = { pageX: scrollX, pageY: scrollY, clientWidth: innerWidth, clientHeight: innerHeight };
      const visual = { ...layout, offsetX: 0, offsetY: 0, scale: 1, zoom: 1 };
      const { scrollWidth: width, scrollHeight: height } = document.documentElement;
      const content = { x: 0, y: 0, width, height };
      return {
        layoutViewport: layout,
        visualViewport: visual,
        contentSize: content,
        cssLayoutViewport: layout,
        cssVisualViewport: visual,
        cssContentSize: content,
      };
    },
    "Page.getNavigationHistory": () => ({
      currentIndex: this.#state.index,
      entries: this.#state.entries.map(({ url, title }, id) => ({
        id,
        url,
        userTypedURL: url,
        title,
        transitionType: "link",
      })),
    }),
    "Page.navigate": ({ url, referrer }: any) => {
      const before = this.#state.page();
      const { promise, resolve } = Promise.withResolvers();
      const committed = () => {
        this.#contents.off("did-navigate", committed).off("did-navigate-in-page", committed);
        const { frameToken } = this.#contents.mainFrame;
        resolve({ frameId: this.#id, loaderId: frameToken === before.token ? undefined : frameToken });
      };
      this.#contents.on("did-navigate", committed).on("did-navigate-in-page", committed);
      this.#contents.loadURL(url, { httpReferrer: referrer }).catch(error => {
        resolve({ frameId: this.#id, errorText: "net::" + error.code });
        committed();
      });
      return promise;
    },
    "Page.navigateToHistoryEntry": ({ entryId }: any) => this.#state.traverse(entryId),
    "Page.reload": () => this.#contents.reload(),
    "Page.setLifecycleEventsEnabled": ({ enabled }: any) => {
      if (enabled) for (const stage of this.#stages) this.#lifecycle(lifecycleNames[stage]);
    },
    "Page.stopLoading": () => this.#contents.stop(),
    "Runtime.addBinding": ({ name }: any) => {
      this.#bindings.$add(name);
      this.#bind(name, this.#context());
    },
    "Runtime.callFunctionOn": (params: any) => {
      const target = params.objectId === undefined ? undefined : this.#object(params.objectId);
      const context = target?.context ?? this.#context(params.executionContextId);
      const world = this.#world(context);
      const args = (params.arguments ?? []).map(argument => {
        if (argument.objectId !== undefined) return this.#object(argument.objectId).value;
        if (argument.unserializableValue === undefined) return world.clone(argument.value);
        const text = argument.unserializableValue;
        return text.endsWith("n") ? BigInt(text.slice(0, -1)) : Number(text);
      });
      return this.#result(context, params, () =>
        world.evaluate(`(${params.functionDeclaration})`, "").$apply(target?.value, args),
      );
    },
    "Runtime.enable": () => {
      if (this.#reportsContexts) return;
      this.#reportsContexts = true;
      for (const context of this.#contexts.values())
        this.#emit("Runtime.executionContextCreated", this.#describeContext(context));
    },
    "Runtime.evaluate": (params: any) => {
      const context = this.#context(params.contextId);
      return this.#result(context, params, () => this.#world(context).evaluate(params.expression, ""));
    },
    "Runtime.getProperties": ({ objectId }: any) => {
      const { value, context } = this.#object(objectId);
      const result = Object.entries(Object.getOwnPropertyDescriptors(value)).map(([name, property]) => ({
        name,
        enumerable: property.enumerable,
        configurable: property.configurable,
        isOwn: true,
        value: "value" in property ? this.#remote(property.value, context) : undefined,
      }));
      return { result };
    },
    "Runtime.releaseObject": ({ objectId }: any) => void this.#objects.$delete(objectId),
    "Target.getTargetInfo": () => ({ targetInfo: targetInfo(this.#contents) }),
  };

  handle(method: string, params: object, { resolve, reject }: Reply) {
    if (method === "Page.getFrameTree" && this.#state.context.parent)
      this.#emit("Page.frameNavigated", { frame: this.#frame(), type: "Navigation" });
    this.run(method, params).then(resolve, reject);
  }

  async run(method: string, params: object) {
    const command = this.#commands[method] ?? this.#input.commands[method];
    if (command) return (await command(params)) || {};
    if (ignored.test(method)) return {};
    throw new Error(`'${method}' wasn't found`);
  }
}

type Session = { handle(method: string, params: object, reply: Reply): void; close(): void };

/** A session of the web engine. The client knows the frame `theirs` as `ours`. */
class EngineSession {
  #children = new Map<string, EngineSession>();
  /** The frame in which the engine has an `<iframe>` of the app, whose parent is `theirs`. */
  inner: string | undefined;
  swappedBack: (() => void) | undefined;
  #hasSwappedBack = false;

  constructor(
    readonly connection: Connection,
    readonly remote: any,
    readonly id: string,
    readonly theirs: string,
    readonly ours: string,
    public emit: Emit,
    readonly isFrame: boolean,
  ) {
    remote.engine.inspected.set(id, (method: string, params: any) => this.#receive(method, params));
  }

  static async attach(connection: Connection, remote: any, ours: string, emit: Emit, isFrame: boolean) {
    const targetId = await remote.view.targetId;
    const { sessionId } = await remote.engine.inspect("Target.attachToTarget", { targetId, flatten: true });
    return new EngineSession(connection, remote, sessionId, targetId, ours, emit, isFrame);
  }

  #rename(value: object, from: string, to: string) {
    return JSON.parse(JSON.stringify(value ?? {}).replaceAll(from, to));
  }

  #receive(method: string, params: any) {
    const { connection, inner, theirs } = this;
    if (method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = params;
      const child = new EngineSession(
        connection,
        this.remote,
        sessionId,
        theirs,
        this.ours,
        connection.emitter(sessionId),
        targetInfo.type === "iframe",
      );
      this.#children.$set(sessionId, child);
      connection.sessions.$set(sessionId, child);
    } else if (method === "Target.detachedFromTarget") {
      this.#children.$get(params.sessionId)?.close();
      this.#children.$delete(params.sessionId);
      this.#hasSwappedBack ||= params.targetId === inner;
    } else if (inner !== undefined) {
      if ((params.frameId ?? params.frame?.id ?? params.context?.auxData?.frameId) === theirs) return;
      if (params.frameId === inner && /^Page\.frame(?:At|De)tached$/.test(method)) return;
    }
    this.emit(method, this.#rename(params, theirs, this.ours));
  }

  announce({ frame, childFrames = [] }: any, isRoot: boolean) {
    if (!isRoot) this.emit("Page.frameAttached", { frameId: frame.id, parentFrameId: frame.parentId });
    this.emit("Page.frameNavigated", { frame, type: "Navigation" });
    for (const child of childFrames) this.announce(child, false);
  }

  handle(method: string, params: object, { resolve, reject }: Reply) {
    this.remote.view.wake();
    this.remote.engine.inspectInOrder(method, this.#rename(params, this.ours, this.theirs), this.id, {
      reject,
      resolve: (result: any) => {
        result = this.#rename(result, this.theirs, this.ours);
        if (method === "Page.getFrameTree" && this.isFrame) {
          if (this.inner !== undefined) result.frameTree = result.frameTree.childFrames?.[0];
          if (result.frameTree) this.announce(result.frameTree, true);
        }
        resolve(result);
        if (this.#hasSwappedBack && method === "Page.enable") setImmediate(this.swappedBack!);
      },
    });
  }

  close() {
    this.#children.$forEach(child => child.close());
    this.connection.sessions.$delete(this.id);
    this.remote.engine.inspected.delete(this.id);
    this.remote.engine.inspect("Target.detachFromTarget", { sessionId: this.id }).catch(() => {});
  }
}

type Child = { frame: any; targetId?: string; sessionId?: string; session?: Session };

class Children {
  #all = new Map<object, Child>();
  #isStarted = false;

  constructor(
    readonly connection: Connection,
    readonly contents: any,
    readonly emit: Emit,
  ) {}

  start() {
    this.#isStarted = true;
    this.update();
  }

  update() {
    if (!this.#isStarted) return;
    const { frames } = this.contents[kPrivate].pageAsItIs();
    this.#all.$forEach(child => frames.has(child.frame) || this.#detach(child));
    for (const frame of frames) {
      if (this.#all.$has(frame)) continue;
      const child = { frame };
      this.#all.$set(frame, child);
      if (frame.engine) this.#attachRemote(child).catch(() => {});
      else this.#attachLocal(child);
    }
  }

  #announce(child: Child, targetId: string, sessionId: string, session: Session) {
    Object.assign(child, { targetId, sessionId, session });
    this.connection.sessions.$set(sessionId, session);
    const targetInfo = {
      targetId,
      type: "iframe",
      title: "",
      url: "",
      attached: true,
      parentFrameId: targetIdOf(this.contents),
    };
    this.emit("Target.attachedToTarget", { sessionId, targetInfo, waitingForDebugger: false });
  }

  #attachLocal(child: Child) {
    const { contents } = child.frame.context.state;
    const sessionId = crypto.randomUUID();
    setImmediate(() => {
      if (this.#all.$get(child.frame) !== child) return;
      this.#announce(
        child,
        targetIdOf(contents),
        sessionId,
        this.connection.local(contents, this.connection.emitter(sessionId)),
      );
    });
  }

  async #attachRemote(child: Child) {
    const { promise: attached, resolve } = Promise.withResolvers<string>();
    const ours = targetIdOf(this.contents);
    const waitForFrame = (method: string, params: any) =>
      method === "Page.frameAttached" && params.parentFrameId === ours && resolve(params.frameId);
    const session = await EngineSession.attach(this.connection, child.frame, ours, waitForFrame, true);
    const inspect = (method: string, params?: object) => child.frame.engine.inspect(method, params, session.id);
    await inspect("Page.enable");
    const { result } = await inspect("Runtime.evaluate", { expression: "document.querySelector('iframe')" });
    const known = result.objectId && (await inspect("DOM.describeNode", { objectId: result.objectId })).node.frameId;
    session.inner = known ?? (await attached);
    if (this.#all.$get(child.frame) !== child) return session.close();
    session.emit = this.connection.emitter(session.id);
    session.swappedBack = () => {
      session.close();
      if (this.#all.$get(child.frame) === child) this.#attachRemote(child).catch(() => {});
    };
    this.#announce(child, session.inner!, session.id, session);
  }

  #detach(child: Child) {
    this.#all.$delete(child.frame);
    if (!child.session) return;
    child.session.close();
    this.connection.sessions.$delete(child.sessionId!);
    this.emit("Target.detachedFromTarget", { sessionId: child.sessionId, targetId: child.targetId });
  }

  idOf(element: object) {
    for (const child of this.#all.values()) if (child.frame.element.self() === element) return child.targetId;
  }

  ownerOf(targetId: string) {
    for (const child of this.#all.values()) if (child.targetId === targetId) return child.frame.element.self();
  }

  close() {
    this.#isStarted = false;
    this.#all.$forEach(child => this.#detach(child));
  }
}

const lasts =
  /^(?:\w+\.(?:enable|disable)|Page\.(?:addScriptToEvaluateOnNewDocument|set\w+)|Runtime\.addBinding|Target\.setAutoAttach|(?:Emulation|Network|Security)\.set\w+)$/;

/** A `WebContents`, whichever engine has its page. */
class ContentsSession {
  #current: Session | Promise<Session>;
  #guest: any;
  #input: Input | undefined;
  #settings: [string, object][] = [];
  destroyed = () => {};

  constructor(
    readonly connection: Connection,
    readonly contents: any,
    readonly emit: Emit,
  ) {
    contents[kPrivate].observers.add(this);
    this.#current = this.#open();
  }

  #open(): Session | Promise<Session> {
    const { connection, contents, emit } = this;
    const guest = (this.#guest = contents[kPrivate].guest);
    return guest
      ? EngineSession.attach(connection, guest, targetIdOf(contents), emit, false)
      : connection.local(contents, emit);
  }

  #restore(session: Session) {
    const nothing = () => {};
    for (const [method, params] of this.#settings)
      session.handle(method, { ...params, runImmediately: true }, { resolve: nothing, reject: nothing });
    return session;
  }

  guestCommitted() {
    this.close();
    this.contents[kPrivate].observers.add(this);
    this.emit("Runtime.executionContextsCleared", {});
    this.#current = Promise.$resolve(this.#open()).then(async (session: any) => {
      const { promise, resolve, reject } = Promise.withResolvers<any>();
      session.handle("Page.getFrameTree", {}, { resolve, reject });
      session.handle("Page.enable", {}, { resolve() {}, reject() {} });
      session.announce((await promise).frameTree, true);
      return this.#restore(session);
    });
    (this.#current as Promise<Session>).catch(() => {});
  }

  documentCreated() {
    if (!this.#guest || this.contents[kPrivate].guest) return;
    this.close();
    this.contents[kPrivate].observers.add(this);
    const session: any = (this.#current = this.#open());
    session.documentCreated();
    this.#restore(session);
  }

  #changeEngine({ url, referrer }: any, { resolve, reject }: Reply) {
    const frameId = targetIdOf(this.contents);
    const answer = ({ frameTree }: any) => resolve({ frameId, loaderId: frameTree.frame.loaderId });
    this.contents.loadURL(url, { httpReferrer: referrer }).then(
      () => this.handle("Page.getFrameTree", {}, { resolve: answer, reject }),
      error => resolve({ frameId, errorText: "net::" + error.code }),
    );
  }

  handle(method: string, params: any, reply: Reply) {
    if (method === "Target.getTargetInfo") return reply.resolve({ targetInfo: targetInfo(this.contents) });
    if (method === "Page.close") {
      setImmediate(() => this.contents.close());
      return reply.resolve({});
    }
    if (method === "Page.navigate" && !!this.#guest !== this.contents[kPrivate].isForGuest(params.url))
      return this.#changeEngine(params, reply);
    const input =
      this.#guest && !method.includes("Touch") && (this.#input ??= new Input(this.contents)).commands[method];
    if (input) {
      input(params);
      return void this.#guest.view.whenIdle().then(reply.resolve);
    }
    if (lasts.test(method)) this.#settings.push([method, params]);
    const current = this.#current;
    if ($isPromise(current)) current.then(session => session.handle(method, params, reply), reply.reject);
    else current.handle(method, params, reply);
  }

  close() {
    this.contents[kPrivate].observers.delete(this);
    const current = this.#current;
    if ($isPromise(current))
      current.then(
        session => session.close(),
        () => {},
      );
    else current.close();
  }
}

const cookieJar = () => require("internal/desktop/electron/session").defaultSession().cookies;
const sameSiteNames = { lax: "Lax", no_restriction: "None", strict: "Strict" };
const urlOfCookie = ({ domain, path = "/", secure }: any) =>
  `http${secure ? "s" : ""}://${domain.replace(/^\./, "")}${path}`;

function targetInfo(contents: any) {
  return {
    targetId: targetIdOf(contents),
    type: "page",
    title: contents.getTitle(),
    url: contents.getURL() || "about:blank",
    attached: true,
    openerId: contents.opener ? targetIdOf(webContents.fromFrame(contents.opener)) : undefined,
    canAccessOpener: false,
    browserContextId: targetIdOf(contents.session),
  };
}

const versionInfo = () => ({ product: `Chrome/${process.versions.chrome}`, userAgent: app.userAgentFallback });

/** It is not known yet which engine will have its page. */
const isUndecided = (contents: any) => !contents[kPrivate].guest && contents[kPrivate].staysInGuest();
const targets = () => webContents.getAllWebContents().filter(contents => !isUndecided(contents));

class Connection {
  #socket;
  sessions = new Map<string, Session>();
  #browserSessions = new Set<string | undefined>([undefined]);
  /** For a connection to one page. */
  #only: Session | undefined;
  #autoAttaches = false;

  constructor(socket: any) {
    this.#socket = socket;
    const { target } = socket.data;
    if (!target) return;
    this.#only = new ContentsSession(this, target, this.emitter(undefined));
    target.once("destroyed", this.#closeSocket);
  }

  #closeSocket = () => this.#socket.close();

  #send(message: object) {
    this.#socket.send(JSON.stringify(message));
  }

  emitter(sessionId: string | undefined): Emit {
    return (method, params) => this.#send({ method, params, sessionId });
  }

  local(contents: any, emit: Emit) {
    const session = new PageSession(contents, emit);
    session.children = new Children(this, contents, emit);
    // The page cannot wait for the answer of the client.
    session.dialog = () => false;
    return session;
  }

  #attach(contents: any, parent: string | undefined) {
    if (!contents) throw new Error("No target with given id found");
    const sessionId = crypto.randomUUID();
    const session = new ContentsSession(this, contents, this.emitter(sessionId));
    this.sessions.$set(sessionId, session);
    const targetId = targetIdOf(contents);
    const emit = this.emitter(parent);
    session.destroyed = () => {
      session.close();
      this.sessions.$delete(sessionId);
      emit("Target.detachedFromTarget", { sessionId, targetId });
    };
    emit("Target.attachedToTarget", { sessionId, targetInfo: targetInfo(contents), waitingForDebugger: false });
    return { sessionId };
  }

  #attachWhenDecided(contents: any) {
    if (contents.isDestroyed() || !this.#autoAttaches) return;
    if (!isUndecided(contents)) return void this.#attach(contents, undefined);
    const { observers } = contents[kPrivate];
    const decided = () => observers.delete(observer) && setImmediate(() => this.#attachWhenDecided(contents));
    const observer = { guestCommitted: decided, documentCreated: decided };
    observers.add(observer);
  }

  #created = (_: unknown, contents: any) => setImmediate(() => this.#attachWhenDecided(contents));

  #commands = {
    "Browser.close": () => void setImmediate(() => app.quit()),
    "Browser.getVersion": () => ({ protocolVersion: "1.3", revision: "", jsVersion: Bun.version, ...versionInfo() }),
    "Storage.clearCookies": async () => {
      for (const cookie of await cookieJar().get({})) await cookieJar().remove(urlOfCookie(cookie), cookie.name);
    },
    "Storage.getCookies": async () => ({
      cookies: (await cookieJar().get({})).map(({ expirationDate: expires = -1, sameSite, ...rest }) => ({
        ...rest,
        expires,
        sameSite: sameSiteNames[sameSite],
      })),
    }),
    "Storage.setCookies": async ({ cookies }: any) => {
      for (const { url, domain, expires, sameSite, ...rest } of cookies) {
        await cookieJar().set({
          ...rest,
          url: url ?? urlOfCookie({ domain, ...rest }),
          domain: domain?.startsWith(".") ? domain : undefined,
          expirationDate: expires > 0 ? expires : undefined,
          sameSite: Object.keys(sameSiteNames).find(it => sameSiteNames[it] === sameSite),
        });
      }
    },
    "Target.attachToBrowserTarget": () => {
      const sessionId = crypto.randomUUID();
      this.#browserSessions.$add(sessionId);
      return { sessionId };
    },
    "Target.attachToTarget": ({ targetId }: any, from?: string) =>
      this.#attach(webContents.fromDevToolsTargetId(targetId), from),
    "Target.closeTarget": ({ targetId }: any) => {
      webContents.fromDevToolsTargetId(targetId)?.close();
      return { success: true };
    },
    "Target.detachFromTarget": ({ sessionId }: any) => {
      if (!this.#browserSessions.$delete(sessionId)) (this.sessions.$get(sessionId) as ContentsSession)?.destroyed?.();
    },
    "Target.getBrowserContexts": () => ({ browserContextIds: [] }),
    "Target.getTargetInfo": () => ({
      targetInfo: { targetId: "browser", type: "browser", title: "", url: "", attached: true },
    }),
    "Target.getTargets": () => ({ targetInfos: targets().map(targetInfo) }),
    "Target.setAutoAttach": ({ autoAttach }: any) => {
      if (autoAttach === this.#autoAttaches) return;
      this.#autoAttaches = autoAttach;
      if (!autoAttach) return void app.off("web-contents-created", this.#created);
      app.on("web-contents-created", this.#created);
      for (const contents of webContents.getAllWebContents()) this.#attachWhenDecided(contents);
    },
  };

  receive(text: string) {
    const { id, method, params = {}, sessionId } = JSON.parse(text);
    const resolve = (result: unknown) => this.#send({ id, sessionId, result: result || {} });
    const reject = (error: any) =>
      this.#send({ id, sessionId, error: { code: -32000, message: String(error?.message) } });
    const session = this.sessions.$get(sessionId) ?? this.#only;
    if (session && !/^(?:Browser|Storage)\./.test(method)) return session.handle(method, params, { resolve, reject });
    if (!session && !this.#browserSessions.$has(sessionId))
      return reject(new Error("Session with given id not found."));
    const command = this.#commands[method];
    if (!command && !ignored.test(method)) return reject(new Error(`'${method}' wasn't found`));
    Promise.try(() => command?.(params, sessionId)).then(resolve, reject);
  }

  close() {
    this.#autoAttaches = false;
    app.off("web-contents-created", this.#created);
    this.#socket.data.target?.off("destroyed", this.#closeSocket);
    this.#only?.close();
    this.sessions.$forEach(session => session.close());
  }
}

function listen(port: number) {
  const browserPath = "/devtools/browser/" + crypto.randomUUID();
  const server = Bun.serve<any>({
    hostname: "127.0.0.1",
    port,
    fetch(request, server) {
      const { pathname, host, hostname } = new URL(request.url);
      // Web pages can reach this port, by its address or by a name that resolves to it.
      if (request.headers.has("origin") || !/^(?:localhost|127\.0\.0\.1)$/.test(hostname))
        return new Response(null, { status: 403 });
      const route = pathname.replace(/\/$/, "");
      if (route === "/json/version") {
        const { product, userAgent } = versionInfo();
        return Response.json({
          "Browser": product,
          "Protocol-Version": "1.3",
          "User-Agent": userAgent,
          "webSocketDebuggerUrl": `ws://${host}${browserPath}`,
        });
      }
      if (route === "/json" || route === "/json/list") {
        return Response.json(
          targets().map(contents => {
            const { targetId: id, type, title, url } = targetInfo(contents);
            return { id, type, title, url, description: "", webSocketDebuggerUrl: `ws://${host}/devtools/page/${id}` };
          }),
        );
      }
      const target = webContents.fromDevToolsTargetId(route.replace("/devtools/page/", ""));
      if ((target || route === browserPath) && server.upgrade(request, { data: { target } })) return;
      return new Response(null, { status: 404 });
    },
    websocket: {
      maxPayloadLength: 1 << 28,
      backpressureLimit: 1 << 28,
      idleTimeout: 0,
      open: socket => void (socket.data.connection = new Connection(socket)),
      message: (socket, message) => socket.data.connection.receive(String(message)),
      close: socket => socket.data.connection.close(),
    },
  });
  server.unref();
  const fs = require("node:fs");
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(
    require("node:path").join(app.getPath("userData"), "DevToolsActivePort"),
    `${server.port}\n${browserPath}`,
  );
  console.error(`\nDevTools listening on ws://127.0.0.1:${server.port}${browserPath}`);
}

export default { PageSession, describeKey, listen, spy, targetIdOf };
