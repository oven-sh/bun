// Called by test_runner/environment.rs. Port of https://github.com/vitest-dev/vitest/tree/v5.0.3/packages/vitest/src/integrations/env

const { createRequire } = require("node:module");
const types = require("node:util/types");

const reportUncaughtException = $newCppFunction("BunProcess.cpp", "jsFunctionReportUncaughtException", 1);
const isInPreload = $newRustFunction("environment.rs", "jsIsInPreload", 0);
const setGlobalObjectWindow: (window: unknown, isGlobalThis?: boolean) => void = $newCppFunction(
  "JSWindowCustom.cpp",
  "jsFunctionSetGlobalObjectWindow",
  2,
);
// This module's copy in a global that outlives the test files.
const lastingCopyOfThisModule: () => typeof setup = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionTestEnvironmentModuleOfLastingRealm",
  0,
);

const { captureStackTrace } = Error;
const { isExtensible } = Object;
const ordinaryHasInstance = Function.prototype[Symbol.hasInstance];
const NativeBlob = Blob;
const NativeFormData = FormData;
const NativeRequest = Request;
const NativeURL = URL;

// Test files can patch builtins before this runs, so use $-private names, index loops and null-prototype descriptors.
type Properties = Map<string, PropertyDescriptor>;

interface Environment {
  window: any;
  properties: Properties;
  keys: string[];
  forgetLastFile?(): void;
  close(): void | Promise<void>;
}

// Always copied from the window, even when `globalThis` already has them.
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
      // Read-only window properties like `document` throw here. The override on globalThis still applies.
      try {
        win[key] = value;
      } catch {}
    },
    enumerable: false,
    configurable: true,
  } as PropertyDescriptor;
}

function windowProperties(
  win: any,
  additionalKeys: string[],
  names: string[] = $Object.$getOwnPropertyNames(win),
  isNative = false,
): Pick<Environment, "window" | "properties" | "keys"> {
  const properties: Properties = new $Map();
  const keys: string[] = [];
  const members = new $Map<string, true>();
  for (let i = 0; isNative && i < names.length; i++) members.$set(names[i], true);
  function take(key: string) {
    if (properties.$has(key)) return;
    if (isNative) {
      // A bun:dom window finds Bun's globals on globalThis, so only its own members are copied there.
      if (!members.$has(key)) return;
      // The interfaces and the document belong to this realm and never change, and JSC reads a plain data property fastest.
      const value = win[key];
      const first = key.$charCodeAt(0);
      const isInterface = typeof value === "function" && first >= 65 /* A */ && first <= 90; /* Z */
      properties.$set(key, isInterface || key === "document" ? dataProperty(value, false) : windowProperty(win, key));
    } else properties.$set(key, windowProperty(win, key));
    $arrayPush(keys, key);
  }
  for (let i = 0; i < additionalKeys.length; i++) take(additionalKeys[i]);
  for (let i = 0; i < KEYS.length; i++) take(KEYS[i]);
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    // Bun has `onerror`, `onmessage` and `reportError` globals but Node doesn't, so vitest ends up with the window's.
    // With --isolate=modules, a name can be on globalThis only because the last file's window put it there.
    const isFromLastWindow = originalDescriptors.$has(key) && !originalDescriptors.$get(key);
    const isOfBunOnly = key === "onerror" || key === "onmessage" || key === "reportError";
    if (!(key in globalThis) || isFromLastWindow || isOfBunOnly) take(key);
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

// Like vitest and Jest, report window errors to the runner unless the file has its own "error" listener.
// Only addEventListener/removeEventListener calls are counted, so `once`, `signal` and `onerror` are ignored.
function catchWindowErrors(win: any, properties: Properties) {
  // Counted as vitest counts them: adding a listener twice counts twice, and so does removing one that was never added.
  let listenersOfPreloads = 0;
  let listenersOfFile = 0;
  const addedByPreloads = new $Map<unknown, true>();
  const addEventListener = win.addEventListener.bind(win);
  const removeEventListener = win.removeEventListener.bind(win);
  function report(event: ErrorEvent) {
    const { error } = event;
    if (listenersOfPreloads + listenersOfFile === 0 && error != null) {
      reportUncaughtException(error);
      event.preventDefault();
    }
  }
  // Capture phase, so a leftover listener from an earlier file can't stop the event first.
  addEventListener(
    "error",
    (event: ErrorEvent) => void (event.eventPhase === 2 /* AT_TARGET */ && report(event)),
    true,
  );
  // Errors that bubble up from elements are still reported in the bubble phase, as in vitest.
  addEventListener("error", (event: ErrorEvent) => void (event.eventPhase === 3 /* BUBBLING_PHASE */ && report(event)));
  properties.$get("addEventListener")!.set!(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "error") {
      if (isInPreload()) {
        listenersOfPreloads++;
        addedByPreloads.$set(args[1], true);
      } else listenersOfFile++;
    }
    return addEventListener.$apply(this, args);
  });
  properties.$get("removeEventListener")!.set!(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "error" && listenersOfPreloads + listenersOfFile > 0) {
      // listenersOfFile is reset after each file, so a preload's listener that a file removes has to come off the other count.
      if (isInPreload() || addedByPreloads.$delete(args[1])) listenersOfPreloads--;
      else listenersOfFile--;
    }
    return removeEventListener.$apply(this, args);
  });
  return () => {
    listenersOfFile = 0;
  };
}

// globalThis keeps Bun's AbortSignal for fetch, but jsdom's addEventListener only accepts its own.
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

// Bun's reportError() knows nothing of this window. Node has none, so there React and others dispatch the event themselves.
function addReportError(win: any, globals: Pick<Environment, "properties" | "keys">) {
  if (typeof win.reportError === "function") return;
  function reportError(error: unknown) {
    if (arguments.length === 0) throw new TypeError("reportError requires at least 1 argument, but only 0 were passed");
    const message =
      typeof error === "object" && error !== null && typeof (error as Error).message === "string"
        ? (error as Error).message
        : String(error);
    if (win.dispatchEvent(new win.ErrorEvent("error", { cancelable: true, message, error }))) console.error(error);
  }
  addProperty(globals, "reportError", dataProperty(reportError, false));
}

// prettier-ignore
const BINARY_CLASSES = [
  "ArrayBuffer", "Uint8Array", "Uint16Array", "Uint32Array", "Uint8ClampedArray", "Int8Array", "Int16Array",
  "Int32Array", "Float32Array", "Float64Array",
] as const;

// These globals are the window's, from another realm than what Bun makes: a Buffer, what TextEncoder, fetch or fs return.
function acceptBinaryDataOfOtherRealms(win: any) {
  for (let i = 0; i < BINARY_CLASSES.length; i++) {
    const name = BINARY_CLASSES[i];
    const constructor = win[name];
    if (typeof constructor !== "function" || constructor === globalThis[name]) continue;
    const isInstance: (value: unknown) => boolean = types[`is${name}`];
    $Object.$defineProperty(constructor, Symbol.hasInstance, {
      __proto__: null,
      // A subclass inherits this function, and only has its own instances.
      value(this: unknown, value: unknown) {
        return ordinaryHasInstance.$call(this, value) || (this === constructor && isInstance(value));
      },
      configurable: true,
    } as PropertyDescriptor);
  }
}

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
    // jsdom 27 renamed sendTo() to forwardTo().
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
    // jsdom 28 renamed `_buffer` to `_bytes`.
    return new NativeBlob([impl._bytes ?? impl._buffer], { type: blob.type });
  }
  function toNativeFormData(formData: any) {
    const native = new NativeFormData();
    formData.forEach((value: any, key: string) =>
      native.append(key, value instanceof win.Blob ? toNativeBlob(value) : value),
    );
    return native;
  }
  // Named by their property key, since the bundler renames a class declaration that shadows a global.
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
  addReportError(win, globals);
  acceptBinaryDataOfOtherRealms(win);
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
  // prettier-ignore
  const globals = windowProperties(win, [
    "Request", "Response", "MessagePort", "fetch", "Headers", "AbortController", "AbortSignal", "URL",
    "URLSearchParams", "FormData",
  ]);
  addReportError(win, globals);
  return {
    ...globals,
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

function createBunDOM(options: any): Environment {
  const { Window } = require("bun:dom");
  const win = new Window({ url: options.url || "http://localhost:3000" });
  // jsdom and happy-dom have every member on the window itself. Here the attributes are accessors on the prototype.
  const names = $Object.$getOwnPropertyNames(win);
  const inherited = $Object.$getOwnPropertyNames(Window.prototype);
  for (let i = 0; i < inherited.length; i++) if (inherited[i] !== "constructor") $arrayPush(names, inherited[i]);
  const globals = windowProperties(win, [], names, true);
  // With --isolate=modules every file's window has these same classes.
  const prototypes: object[] = [];
  globals.properties.$forEach(({ value }) => {
    if (typeof value !== "function") return;
    const { prototype } = value;
    if (prototype) $arrayPush(prototypes, prototype);
  });
  require("internal/test/globals").track(prototypes);
  // jsdom has no URL.createObjectURL() and revokeObjectURL(), so tests written for it define their own and delete them
  // afterwards. On a subclass that uncovers Bun's. Named by its property key, like the classes for jsdom above.
  const compat = {
    URL: class extends NativeURL {
      static [Symbol.hasInstance](instance: unknown) {
        return instance instanceof NativeURL;
      }
    },
  };
  addProperty(globals, "URL", dataProperty(compat.URL, false));
  const forgetLastFile = catchWindowErrors(win, globals.properties);
  // So that native code takes globalThis for this window, as in `new MouseEvent("click", { view: window })`,
  // and hands out globalThis where it would hand out this window, as in `iframe.contentWindow.parent` and `event.source`.
  setGlobalObjectWindow(win, true);
  return {
    ...globals,
    forgetLastFile,
    close() {
      setGlobalObjectWindow(null);
      win.close();
    },
  };
}

// Without --isolate, modules outlive a file and hold on to DOM nodes, so the window has to outlive it too.
const kept = new $Map<string, Environment>();
// require() of a module with top-level await throws only the first time, so rethrow that error for every file.
const failedToLoad = new $Map<string, unknown>();

function isClosed(window: Environment["window"]) {
  return window.closed || !window.document;
}

// jsdom parses its default style sheet with the first window that's asked for a computed style, and keeps that window.
function openWindowForJSDOMToKeep({ JSDOM }: any) {
  try {
    const { window } = new JSDOM();
    window.getComputedStyle(window.document.documentElement);
    window.close();
  } catch {}
}

function find(name: string, file: string, outlivesTestFiles: boolean) {
  const requireFromTest = createRequire(file);
  let packagePath: string;
  try {
    packagePath = requireFromTest.resolve(name);
  } catch {
    return `cannot find package "${name}"\nnote: to install it, run "bun add -d ${name}"`;
  }
  return {
    packagePath,
    requireFromTest,
    load() {
      if (failedToLoad.$has(packagePath)) throw failedToLoad.$get(packagePath);
      const isLoaded = packagePath in requireFromTest.cache;
      let exports;
      try {
        exports = requireFromTest(packagePath);
      } catch (error) {
        failedToLoad.$set(packagePath, error);
        throw error;
      }
      if (outlivesTestFiles && !isLoaded && name === "jsdom") openWindowForJSDOMToKeep(exports);
      return exports;
    },
  };
}

function open(
  name: "jsdom" | "happy-dom" | "bun:dom",
  optionsText: string | undefined,
  file: string,
  keep: boolean,
  beforeCreating: () => void,
  sharesGlobal = false,
) {
  if (name === "bun:dom") {
    const id = `${name}\n${optionsText ?? ""}`;
    const last = kept.$get(id);
    if (last && !isClosed(last.window)) return last;
    beforeCreating();
    let options;
    try {
      options = optionsText === undefined ? undefined : JSON.parse(optionsText);
    } catch (error) {
      return `its options are not JSON: ${(error as Error).message}`;
    }
    const environment = createBunDOM(options ?? {});
    if (keep) kept.$set(id, environment);
    return environment;
  }
  // With --isolate every file has a new global. Loaded into that, the package would be evaluated and compiled again for each file.
  const found = (keep || sharesGlobal ? find : lastingCopyOfThisModule().find)(name, file, !keep);
  if (typeof found === "string") return found;
  const { packagePath, requireFromTest } = found;

  const id = `${packagePath}\n${optionsText ?? ""}`;
  const last = kept.$get(id);
  if (last && !isClosed(last.window)) return last;
  // Which names a new window gives globalThis depends on the names that are there.
  beforeCreating();

  let options;
  try {
    options = optionsText === undefined ? undefined : JSON.parse(optionsText);
  } catch (error) {
    return `its options are not JSON: ${(error as Error).message}`;
  }
  const environment = (name === "jsdom" ? createJSDOM : createHappyDOM)(requireFromTest, found.load(), options ?? {});
  if (keep && typeof environment !== "string") kept.$set(id, environment);
  return environment;
}

function ownProperty(key: string): PropertyDescriptor | undefined {
  const descriptor = $Object.$getOwnPropertyDescriptor(globalThis, key);
  return descriptor && ({ __proto__: null, ...descriptor } as PropertyDescriptor);
}

function putBack(key: string, original: PropertyDescriptor | undefined) {
  try {
    if (original) $Object.$defineProperty(globalThis, key, original);
    else delete (globalThis as any)[key];
    return true;
  } catch {
    return false;
  }
}

// Without --isolate. JSC stops caching reads of globals once several hundred names have been deleted from globalThis
// and defined again a few times. So the last file's names stay until a file needs another environment.
let left: { environment: Environment; teardown(isLoadingFileAgain: boolean): unknown; leave(): unknown } | undefined;

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
      for (let j = defined.length; j--;) putBack(defined[j], originals[j]);
      return `cannot define "${key}" on globalThis: ${(error as Error).message}`;
    }
    $arrayPush(defined, key);
    $arrayPush(originals, original);
  }
  environment.forgetLastFile?.();

  function teardown(isLoadingFileAgain: boolean) {
    if (isLoadingFileAgain) {
      environment.forgetLastFile?.();
      return isClosed(environment.window);
    }
    // What can't be put back is this file's error, not the next one's.
    if (!keep || !isExtensible(globalThis)) return leave();
    for (let i = 0; i < defined.length; i++) if (ownProperty(defined[i])?.configurable === false) return leave();
    left = { environment, teardown, leave };
    return true;
  }

  function leave() {
    let stuck: string | undefined;
    for (let i = 0; i < defined.length; i++) {
      const key = defined[i];
      const ours = properties.$get(key)!;
      // Keep what the file (or a preload) redefined for the next file in this environment.
      const current = ownProperty(key);
      if (current) properties.$set(key, current);
      else properties.$delete(key);

      if (putBack(key, originals[i])) continue;
      // Only an error if the stuck property is still ours, not one the file redefined as non-configurable.
      if (!current || (current.get === ours.get && current.value === ours.value)) stuck ??= key;
    }
    const closed = keep ? undefined : environment.close();
    if (stuck !== undefined) {
      throw new Error(
        `Cannot tear down the "${name}" test environment: globalThis.${stuck} can no longer be redefined`,
      );
    }
    return closed;
  }

  return teardown;
}

// With --isolate=modules, every file gets a new window but globalThis is shared. Redefining several hundred accessors a few
// times makes JSC stop caching global reads, just like deleting them (see `left`). So each accessor is defined once and
// forwards to the current file's window.
let currentWindowProperties: Properties | undefined;
const forwarders = new $Map<string, PropertyDescriptor>();
const originalDescriptors = new $Map<string, PropertyDescriptor | undefined>();

function forwarder(key: string) {
  let descriptor = forwarders.$get(key);
  if (!descriptor) {
    descriptor = {
      __proto__: null,
      get() {
        return currentWindowProperties?.$get(key)?.get?.$call(this);
      },
      set(value) {
        currentWindowProperties?.$get(key)?.set?.$call(this, value);
      },
      enumerable: false,
      configurable: true,
    } as PropertyDescriptor;
    forwarders.$set(key, descriptor);
  }
  return descriptor;
}

function uninstallFromSharedGlobal() {
  currentWindowProperties = undefined;
  originalDescriptors.$forEach((original, key) => void putBack(key, original));
  originalDescriptors.$clear();
}

function installOnSharedGlobal(environment: Environment) {
  const { properties, keys } = environment;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const windowDescriptor = properties.$get(key);
    if (!windowDescriptor) continue;
    const descriptor = windowDescriptor.get ? forwarder(key) : windowDescriptor;
    const current = ownProperty(key);
    if (current?.configurable === false) continue;
    if (current && current.get === descriptor.get && current.value === descriptor.value) continue;
    if (!originalDescriptors.$has(key)) originalDescriptors.$set(key, current);
    $Object.$defineProperty(globalThis, key, descriptor);
  }
  // Remove names that only the previous window had.
  originalDescriptors.$forEach((original, key) => {
    if (properties.$has(key)) return;
    putBack(key, original);
    originalDescriptors.$delete(key);
  });
  currentWindowProperties = properties;
}

function setupSharedGlobal(
  name: "node" | "jsdom" | "happy-dom" | "bun:dom",
  optionsText: string | undefined,
  file: string,
  isFromComment: boolean,
) {
  if (name === "node") return uninstallFromSharedGlobal();
  let result;
  try {
    result = open(name, optionsText, file, false, () => {}, true);
  } catch (error) {
    if (!isFromComment) throw error;
    result = String((error as Error)?.message ?? error);
  }
  if (typeof result === "string") {
    uninstallFromSharedGlobal();
    const message = `Cannot set up the "${name}" test environment for "${file}": ${result}`;
    if (isFromComment) return message;
    const error = new Error(message);
    captureStackTrace(error, setup);
    throw error;
  }
  const environment = result;
  installOnSharedGlobal(environment);
  return function teardown(isLoadingFileAgain: boolean) {
    if (!isLoadingFileAgain) return environment.close();
    environment.forgetLastFile?.();
    return isClosed(environment.window);
  };
}

// Returns a teardown function, or undefined if a preload already set up a DOM.
// On failure it throws, or returns a warning string if `isFromComment`.
function setup(
  name: "node" | "jsdom" | "happy-dom" | "bun:dom",
  optionsText: string | undefined,
  file: string,
  keep: boolean,
  isFromComment: boolean,
  sharesGlobal: boolean,
) {
  if (sharesGlobal) return setupSharedGlobal(name, optionsText, file, isFromComment);
  let last = left;
  left = undefined;
  function leaveLast() {
    const { leave } = last!;
    last = undefined;
    leave();
  }
  if (name === "node") return last && leaveLast();
  if (!last && "document" in globalThis) return;

  let result;
  try {
    result = open(name, optionsText, file, keep, () => last && leaveLast());
  } catch (error) {
    if (last) leaveLast();
    if (!isFromComment) throw error;
    result = String((error as Error)?.message ?? error);
  }
  if (last) {
    const { environment, teardown } = last;
    if (result === environment) {
      environment.forgetLastFile?.();
      return teardown;
    }
    leaveLast();
    if ("document" in globalThis) return;
  }
  if (typeof result !== "string") result = enter(name, result, keep);
  if (typeof result !== "string") return result;

  const message = `Cannot set up the "${name}" test environment for "${file}": ${result}`;
  if (isFromComment) return message;
  const error = new Error(message);
  captureStackTrace(error, setup);
  throw error;
}

setup.find = find;
// For internal/test/globals.ts.
setup.isEnvironmentGlobal = (key: PropertyKey) => originalDescriptors.$has(key as string);

export default setup;
