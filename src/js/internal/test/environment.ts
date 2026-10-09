// Called by test_runner/environment.rs. Port of https://github.com/vitest-dev/vitest/tree/v5.0.3/packages/vitest/src/integrations/env

const { createRequire } = require("node:module");

const reportUncaughtException = $newCppFunction("BunProcess.cpp", "jsFunctionReportUncaughtException", 1);
const isInPreload = $newRustFunction("environment.rs", "jsIsInPreload", 0);

const { captureStackTrace } = Error;
const NativeBlob = Blob;
const NativeFormData = FormData;
const NativeRequest = Request;
const NativeURL = URL;

// This runs between files that may have patched anything: private names, no iterators, descriptors without a prototype.
type Properties = Map<string, PropertyDescriptor>;

interface Environment {
  window: any;
  /** What `globalThis` has while a file runs in this environment. */
  properties: Properties;
  /** The keys `properties` had at first, in the order they are defined. */
  keys: string[];
  /** Called when a file is about to load, each time it does. */
  forgetLastFile?(): void;
  close(): void | Promise<void>;
}

// Taken from the window even when `globalThis` has them.
// prettier-ignore
const KEYS = [
  "DOMException", "EventTarget", "NamedNodeMap", "Node", "Attr", "Element", "DocumentFragment", "DOMImplementation",
  "Document", "XMLDocument", "CharacterData", "Text", "CDATASection", "ProcessingInstruction", "Comment",
  "DocumentType", "NodeList", "RadioNodeList", "HTMLCollection", "HTMLOptionsCollection", "DOMStringMap",
  "DOMTokenList", "StyleSheetList", "HTMLElement", "HTMLHeadElement", "HTMLTitleElement", "HTMLBaseElement",
  "HTMLLinkElement", "HTMLMetaElement", "HTMLStyleElement", "HTMLBodyElement", "HTMLHeadingElement",
  "HTMLParagraphElement", "HTMLHRElement", "HTMLPreElement", "HTMLUListElement", "HTMLOListElement", "HTMLLIElement",
  "HTMLMenuElement", "HTMLDListElement", "HTMLDivElement", "HTMLAnchorElement", "HTMLAreaElement", "HTMLBRElement",
  "HTMLButtonElement", "HTMLCanvasElement", "HTMLDataElement", "HTMLDataListElement", "HTMLDetailsElement",
  "HTMLDialogElement", "HTMLDirectoryElement", "HTMLFieldSetElement", "HTMLFontElement", "HTMLFormElement",
  "HTMLHtmlElement", "HTMLImageElement", "HTMLInputElement", "HTMLLabelElement", "HTMLLegendElement",
  "HTMLMapElement", "HTMLMarqueeElement", "HTMLMediaElement", "HTMLMeterElement", "HTMLModElement",
  "HTMLOptGroupElement", "HTMLOptionElement", "HTMLOutputElement", "HTMLPictureElement", "HTMLProgressElement",
  "HTMLQuoteElement", "HTMLScriptElement", "HTMLSelectElement", "HTMLSlotElement", "HTMLSourceElement",
  "HTMLSpanElement", "HTMLTableCaptionElement", "HTMLTableCellElement", "HTMLTableColElement", "HTMLTableElement",
  "HTMLTimeElement", "HTMLTableRowElement", "HTMLTableSectionElement", "HTMLTemplateElement", "HTMLTextAreaElement",
  "HTMLUnknownElement", "HTMLFrameElement", "HTMLFrameSetElement", "HTMLIFrameElement", "HTMLEmbedElement",
  "HTMLObjectElement", "HTMLParamElement", "HTMLVideoElement", "HTMLAudioElement", "HTMLTrackElement",
  "HTMLFormControlsCollection", "SVGElement", "SVGGraphicsElement", "SVGSVGElement", "SVGTitleElement",
  "SVGAnimatedString", "SVGNumber", "SVGStringList", "Event", "CloseEvent", "CustomEvent", "MessageEvent",
  "ErrorEvent", "HashChangeEvent", "PopStateEvent", "StorageEvent", "ProgressEvent", "PageTransitionEvent",
  "SubmitEvent", "UIEvent", "FocusEvent", "InputEvent", "MouseEvent", "KeyboardEvent", "TouchEvent",
  "CompositionEvent", "WheelEvent", "BarProp", "External", "Location", "History", "Screen", "Crypto", "Performance",
  "Navigator", "PluginArray", "MimeTypeArray", "Plugin", "MimeType", "FileReader", "FormData", "Blob", "File",
  "FileList", "ValidityState", "DOMParser", "XMLSerializer", "XMLHttpRequestEventTarget", "XMLHttpRequestUpload",
  "XMLHttpRequest", "WebSocket", "NodeFilter", "NodeIterator", "TreeWalker", "AbstractRange", "Range", "StaticRange",
  "Selection", "Storage", "CustomElementRegistry", "ShadowRoot", "MutationObserver", "MutationRecord", "Uint8Array",
  "Uint16Array", "Uint32Array", "Uint8ClampedArray", "Int8Array", "Int16Array", "Int32Array", "Float32Array",
  "Float64Array", "ArrayBuffer", "DOMRectReadOnly", "DOMRect", "Image", "Audio", "Option", "CSS",
  "addEventListener", "alert", "blur", "cancelAnimationFrame", "close", "confirm", "createPopup", "dispatchEvent",
  "document", "focus", "frames", "getComputedStyle", "history", "innerHeight", "innerWidth", "length", "localStorage",
  "location", "matchMedia", "moveBy", "moveTo", "name", "navigator", "open", "outerHeight", "outerWidth",
  "pageXOffset", "pageYOffset", "parent", "postMessage", "print", "prompt", "removeEventListener",
  "requestAnimationFrame", "resizeBy", "resizeTo", "screen", "screenLeft", "screenTop", "screenX", "screenY",
  "scroll", "scrollBy", "scrollLeft", "scrollTo", "scrollTop", "scrollX", "scrollY", "self", "sessionStorage", "stop",
  "top", "Window", "window",
];
const SELF_KEYS = ["window", "self", "top", "parent"];

function dataProperty(value: unknown, enumerable: boolean): PropertyDescriptor {
  return { __proto__: null, value, writable: true, enumerable, configurable: true } as PropertyDescriptor;
}

function windowProperty(win: any, key: string): PropertyDescriptor {
  const initial = win[key];
  const first = key.$charCodeAt(0);
  const bound = typeof initial === "function" && first >= 97 /* a */ && first <= 122 /* z */ && initial.bind(win);
  let isOverridden = false;
  let override: unknown;
  return {
    __proto__: null,
    get() {
      return isOverridden ? override : bound || win[key];
    },
    set(value) {
      isOverridden = true;
      override = value;
      // The window has read-only properties (`document`), globalThis as vitest sets it up has none.
      try {
        win[key] = value;
      } catch {}
    },
    enumerable: false,
    configurable: true,
  } as PropertyDescriptor;
}

function windowProperties(win: any, additionalKeys: string[]): Pick<Environment, "window" | "properties" | "keys"> {
  const properties: Properties = new $Map();
  const keys: string[] = [];
  function take(key: string) {
    if (properties.$has(key)) return;
    properties.$set(key, windowProperty(win, key));
    $arrayPush(keys, key);
  }
  for (let i = 0; i < additionalKeys.length; i++) take(additionalKeys[i]);
  for (let i = 0; i < KEYS.length; i++) take(KEYS[i]);
  const names = $Object.$getOwnPropertyNames(win);
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    // Node.js does not have these two globals of Bun, so vitest takes the window's.
    if (!(key in globalThis) || key === "onerror" || key === "onmessage") take(key);
  }
  for (let i = 0; i < SELF_KEYS.length; i++) properties.$set(SELF_KEYS[i], dataProperty(globalThis, true));
  const { document } = win;
  if (document?.defaultView) {
    $Object.$defineProperty(document, "defaultView", {
      __proto__: null,
      get: () => globalThis,
      enumerable: true,
      configurable: true,
    } as PropertyDescriptor);
  }
  return { window: win, properties, keys };
}

/**
 * As vitest and Jest: errors go to the runner unless the file listens for them, counted by its calls alone (so
 * `{ once: true }`, `signal` and `onerror` do not count down or up). Returns what forgets the listeners of a file.
 */
function catchWindowErrors(win: any, properties: Properties) {
  let listenersOfPreloads = 0;
  let listenersOfFile = 0;
  const addEventListener = win.addEventListener.bind(win);
  const removeEventListener = win.removeEventListener.bind(win);
  function report(event: ErrorEvent) {
    const { error } = event;
    if (listenersOfPreloads + listenersOfFile === 0 && error != null) {
      reportUncaughtException(error);
      event.preventDefault();
    }
  }
  // jsdom dispatches an uncaught error at the window. The first capturing listener there is called before any other,
  // so no listener that an earlier file left on the window can stop the event first.
  addEventListener(
    "error",
    (event: ErrorEvent) => void (event.eventPhase === 2 /* AT_TARGET */ && report(event)),
    true,
  );
  // A capturing listener also sees the events of elements, bubbling or not: those stay with this one, as in vitest.
  addEventListener("error", (event: ErrorEvent) => void (event.eventPhase === 3 /* BUBBLING_PHASE */ && report(event)));
  properties.$get("addEventListener")!.set!(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "error") {
      if (isInPreload()) listenersOfPreloads++;
      else listenersOfFile++;
    }
    return addEventListener.$apply(this, args);
  });
  properties.$get("removeEventListener")!.set!(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "error" && listenersOfPreloads + listenersOfFile > 0) {
      if (isInPreload()) listenersOfPreloads--;
      else listenersOfFile--;
    }
    return removeEventListener.$apply(this, args);
  });
  return () => {
    listenersOfFile = 0;
  };
}

// `AbortSignal` stays Bun's (fetch needs it), jsdom only takes its own.
function acceptNativeAbortSignals(win: any) {
  const controllers = new WeakMap<AbortSignal, AbortController>();
  const { AbortController: JSDOMAbortController, AbortSignal: JSDOMAbortSignal } = win;
  const original = win.EventTarget.prototype.addEventListener;
  win.EventTarget.prototype.addEventListener = function addEventListener(
    type: unknown,
    callback: unknown,
    options: any,
  ) {
    const signal = typeof options === "object" ? options?.signal : undefined;
    if (signal != null && !(signal instanceof JSDOMAbortSignal)) {
      let controller = controllers.get(signal);
      if (!controller) {
        const created: AbortController = (controller = new JSDOMAbortController());
        signal.addEventListener("abort", () => created.abort(signal.reason));
        controllers.set(signal, created);
      }
      options = { __proto__: null, ...options, signal: controller!.signal };
    }
    return original.$call(this, type, callback, options);
  };
}

// jsdom has no public, synchronous way to read a Blob's bytes.
function blobImplGetter(requireFromTest: NodeJS.Require, win: any): (blob: unknown) => any {
  const ids = ["jsdom/lib/generated/idl/utils.js", "jsdom/lib/jsdom/living/generated/utils.js"];
  for (let i = 0; i < ids.length; i++) {
    try {
      const { implForWrapper } = requireFromTest(ids[i]);
      if (typeof implForWrapper === "function") return implForWrapper;
    } catch {}
  }
  const implSymbol = $Object.$getOwnPropertySymbols(new win.Blob())[0];
  return (blob: any) => blob[implSymbol];
}

function addProperty(
  { properties, keys }: Pick<Environment, "properties" | "keys">,
  key: string,
  value: PropertyDescriptor,
) {
  if (!properties.$has(key)) $arrayPush(keys, key);
  properties.$set(key, value);
}

/** Like `createHappyDOM`, returns why not if it cannot. */
function createJSDOM(requireFromTest: NodeJS.Require, exports: any, options: any): Environment | string {
  const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } = exports;
  if (typeof JSDOM !== "function") return "the package does not export JSDOM";
  const {
    html = "<!DOCTYPE html>",
    userAgent,
    url = "http://localhost:3000",
    contentType = "text/html",
    pretendToBeVisual = true,
    includeNodeLocations = false,
    runScripts = "dangerously",
    resources,
    console: forwardsConsole = false,
    cookieJar = false,
    ...restOptions
  } = options;
  let virtualConsole;
  if (forwardsConsole) {
    virtualConsole = new VirtualConsole();
    // jsdom 27 renamed it.
    if ("sendTo" in virtualConsole) virtualConsole.sendTo(console);
    else virtualConsole.forwardTo(console);
  }
  const dom = new JSDOM(html, {
    pretendToBeVisual,
    runScripts,
    url,
    virtualConsole,
    cookieJar: cookieJar ? new CookieJar() : undefined,
    includeNodeLocations,
    contentType,
    // jsdom 28 replaced ResourceLoader with an options object.
    ...(ResourceLoader
      ? { resources: resources ?? (userAgent ? new ResourceLoader({ userAgent }) : undefined), userAgent }
      : { resources: userAgent ? { userAgent } : resources }),
    ...restOptions,
  });
  const win = dom.window;
  acceptNativeAbortSignals(win);
  const globals = windowProperties(win, []);
  const forgetLastFile = catchWindowErrors(win, globals.properties);

  const getBlobImpl = blobImplGetter(requireFromTest, win);
  function toNativeBlob(blob: any) {
    const impl = getBlobImpl(blob);
    // jsdom 28 renamed `_buffer`.
    return new NativeBlob([impl._bytes ?? impl._buffer], { type: blob.type });
  }
  function toNativeFormData(formData: any) {
    const native = new NativeFormData();
    formData.forEach((value: any, key: string) =>
      native.append(key, value instanceof win.Blob ? toNativeBlob(value) : value),
    );
    return native;
  }
  // As properties, for their `name`: the bundler renames a class that shadows a global.
  const compat = {
    Request: class extends NativeRequest {
      constructor(input: any, init?: RequestInit) {
        const body = init?.body;
        if (body instanceof win.Blob) init = { ...init, body: toNativeBlob(body) };
        else if (body instanceof win.FormData) init = { ...init, body: toNativeFormData(body) };
        super(input, init);
      }
      static [Symbol.hasInstance](instance: unknown) {
        return instance instanceof NativeRequest;
      }
    },
    URL: class extends NativeURL {
      static createObjectURL(blob: Blob) {
        return NativeURL.createObjectURL(blob instanceof win.Blob ? toNativeBlob(blob) : blob);
      }
      static [Symbol.hasInstance](instance: unknown) {
        return instance instanceof NativeURL;
      }
    },
  };
  addProperty(globals, "jsdom", dataProperty(dom, true));
  addProperty(globals, "Request", dataProperty(compat.Request, false));
  addProperty(globals, "URL", dataProperty(compat.URL, false));
  return { ...globals, forgetLastFile, close: () => win.close() };
}

function createHappyDOM(_: NodeJS.Require, exports: any, options: any): Environment | string {
  const Window = exports.GlobalWindow || exports.Window;
  if (typeof Window !== "function") return "the package does not export Window";
  const win = new Window({
    ...options,
    console,
    url: options.url || "http://localhost:3000",
    settings: { ...options.settings, disableErrorCapturing: true },
  });
  return {
    // prettier-ignore
    ...windowProperties(win, [
      "Request", "Response", "MessagePort", "fetch", "Headers", "AbortController", "AbortSignal", "URL",
      "URLSearchParams", "FormData",
    ]),
    async close() {
      if (win.close && win.happyDOM.abort) {
        await win.happyDOM.abort();
        win.close();
      } else {
        win.happyDOM.cancelAsync();
      }
    },
  };
}

// Without --isolate modules outlive a file, and keep what they read from `document`: so does the window.
const kept = new $Map<string, Environment>();
// A module with a top-level await cannot be required the first time and can the second: every file gets the first answer.
const failedToLoad = new $Map<string, unknown>();

function isClosed(window: Environment["window"]) {
  return window.closed || !window.document;
}

/** Returns why not, if it cannot. */
function open(name: "jsdom" | "happy-dom", optionsText: string | undefined, file: string, keep: boolean) {
  const requireFromTest = createRequire(file);
  let packagePath: string;
  try {
    packagePath = requireFromTest.resolve(name);
  } catch {
    return `cannot find package "${name}"\nnote: to install it, run "bun add -d ${name}"`;
  }

  const id = `${packagePath}\n${optionsText ?? ""}`;
  const last = kept.$get(id);
  if (last && !isClosed(last.window)) return last;

  let options;
  try {
    options = optionsText === undefined ? undefined : JSON.parse(optionsText);
  } catch (error) {
    return `its options are not JSON: ${(error as Error).message}`;
  }
  if (failedToLoad.$has(packagePath)) throw failedToLoad.$get(packagePath);
  let exports;
  try {
    exports = requireFromTest(packagePath);
  } catch (error) {
    failedToLoad.$set(packagePath, error);
    throw error;
  }
  const environment = (name === "jsdom" ? createJSDOM : createHappyDOM)(requireFromTest, exports, options ?? {});
  if (keep && typeof environment !== "string") kept.$set(id, environment);
  return environment;
}

function ownProperty(key: string): PropertyDescriptor | undefined {
  const descriptor = $Object.$getOwnPropertyDescriptor(globalThis, key);
  return descriptor && ({ __proto__: null, ...descriptor } as PropertyDescriptor);
}

/** False if script has made that impossible. */
function putBack(key: string, original: PropertyDescriptor | undefined) {
  try {
    if (original) $Object.$defineProperty(globalThis, key, original);
    else delete (globalThis as any)[key];
    return true;
  } catch {
    return false;
  }
}

/** All of its properties or none: returns what takes them away again, or why it cannot. */
function enter(name: string, environment: Environment, keep: boolean) {
  const { properties, keys } = environment;
  const defined: string[] = [];
  const originals: (PropertyDescriptor | undefined)[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const descriptor = properties.$get(key);
    if (!descriptor) continue;
    const original = ownProperty(key);
    if (original?.configurable === false) continue;
    try {
      $Object.$defineProperty(globalThis, key, descriptor);
    } catch (error) {
      for (let j = defined.length; j--; ) putBack(defined[j], originals[j]);
      return `cannot define "${key}" on globalThis: ${(error as Error).message}`;
    }
    $arrayPush(defined, key);
    $arrayPush(originals, original);
  }
  environment.forgetLastFile?.();

  return function teardown(isLoadingFileAgain: boolean) {
    if (isLoadingFileAgain) {
      environment.forgetLastFile?.();
      return isClosed(environment.window);
    }

    let stuck: string | undefined;
    for (let i = 0; i < defined.length; i++) {
      const key = defined[i];
      const ours = properties.$get(key)!;
      // What the file (or a preload) redefined is there again for the next file in this environment.
      const current = ownProperty(key);
      if (current) properties.$set(key, current);
      else properties.$delete(key);

      if (putBack(key, originals[i])) continue;
      // A property of its own that the file made permanent is the file's to leave behind, like any other global.
      if (!current || (current.get === ours.get && current.value === ours.value)) stuck ??= key;
    }
    const closed = keep ? undefined : environment.close();
    if (stuck !== undefined) {
      throw new Error(
        `The "${name}" test environment cannot be taken away: "${stuck}" of globalThis can no longer be redefined`,
      );
    }
    return closed;
  };
}

/** Returns what undoes it, nothing if a preload brought its own DOM, or `isFromComment` and it cannot: the warning. */
function setup(
  name: "jsdom" | "happy-dom",
  optionsText: string | undefined,
  file: string,
  keep: boolean,
  isFromComment: boolean,
) {
  if ("document" in globalThis) return;

  let result;
  try {
    result = open(name, optionsText, file, keep);
  } catch (error) {
    if (!isFromComment) throw error;
    result = String((error as Error)?.message ?? error);
  }
  if (typeof result !== "string") result = enter(name, result, keep);
  if (typeof result !== "string") return result;

  const message = `Cannot set up the "${name}" test environment of "${file}": ${result}`;
  if (isFromComment) return message;
  const error = new Error(message);
  // Every frame would be of this file.
  captureStackTrace(error, setup);
  throw error;
}

export default setup;
