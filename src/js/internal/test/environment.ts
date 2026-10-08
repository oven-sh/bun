// Called by test_runner/environment.rs. Port of https://github.com/vitest-dev/vitest/tree/v5.0.3/packages/vitest/src/integrations/env

const { createRequire } = require("node:module");

const reportUncaughtException = $newCppFunction("BunProcess.cpp", "jsFunctionReportUncaughtException", 1);

const { defineProperty, getOwnPropertyDescriptor, getOwnPropertyNames, getOwnPropertySymbols } = Object;
const { defineProperty: tryDefineProperty, deleteProperty } = Reflect;
const { captureStackTrace } = Error;
const NativeBlob = Blob;
const NativeFormData = FormData;
const NativeRequest = Request;
const NativeURL = URL;

type Properties = Map<string, PropertyDescriptor>;

interface Environment {
  /** What `globalThis` has while a file runs in this environment. */
  properties: Properties;
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
// Globals of Bun that Node.js does not have, so vitest takes the window's.
const BUN_KEYS = ["onerror", "onmessage"];
const SELF_KEYS = ["window", "self", "top", "parent"];

function dataProperty(value: unknown, enumerable: boolean): PropertyDescriptor {
  return { value, writable: true, enumerable, configurable: true };
}

function windowProperty(win: any, key: string): PropertyDescriptor {
  const initial = win[key];
  const bound = typeof initial === "function" && key[0] !== key[0].toUpperCase() && initial.bind(win);
  let isOverridden = false;
  let override: unknown;
  return {
    get() {
      return isOverridden ? override : bound || win[key];
    },
    set(value) {
      isOverridden = true;
      override = value;
      win[key] = value;
    },
    enumerable: false,
    configurable: true,
  };
}

function windowProperties(win: any, additionalKeys: string[]): Properties {
  const taken = new Set(additionalKeys.concat(KEYS));
  const properties: Properties = new Map();
  for (const key of taken) properties.$set(key, windowProperty(win, key));
  for (const key of BUN_KEYS) taken.$add(key);
  for (const key of getOwnPropertyNames(win)) {
    if (properties.$has(key) || (key in globalThis && !taken.$has(key))) continue;
    properties.$set(key, windowProperty(win, key));
  }
  for (const key of SELF_KEYS) properties.$set(key, dataProperty(globalThis, true));
  const { document } = win;
  if (document?.defaultView) {
    defineProperty(document, "defaultView", { get: () => globalThis, enumerable: true, configurable: true });
  }
  return properties;
}

function catchWindowErrors(win: any, properties: Properties) {
  let userErrorListenerCount = 0;
  const addEventListener = win.addEventListener.bind(win);
  const removeEventListener = win.removeEventListener.bind(win);
  addEventListener("error", (event: ErrorEvent) => {
    const { error } = event;
    if (userErrorListenerCount === 0 && error != null) {
      event.preventDefault();
      reportUncaughtException(error);
    }
  });
  properties.$get("addEventListener")!.set!(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "error") userErrorListenerCount++;
    return addEventListener.$apply(this, args);
  });
  properties.$get("removeEventListener")!.set!(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "error" && userErrorListenerCount) userErrorListenerCount--;
    return removeEventListener.$apply(this, args);
  });
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
  for (const id of ["jsdom/lib/generated/idl/utils.js", "jsdom/lib/jsdom/living/generated/utils.js"]) {
    try {
      const { implForWrapper } = requireFromTest(id);
      if (typeof implForWrapper === "function") return implForWrapper;
    } catch {}
  }
  const implSymbol = getOwnPropertySymbols(new win.Blob())[0];
  return (blob: any) => blob[implSymbol];
}

function createJSDOM(requireFromTest: NodeJS.Require, packagePath: string, options: any): Environment {
  const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } = requireFromTest(packagePath);
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
  const properties = windowProperties(win, []);
  catchWindowErrors(win, properties);

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
  properties.$set("jsdom", dataProperty(dom, true));
  properties.$set("Request", dataProperty(compat.Request, false));
  properties.$set("URL", dataProperty(compat.URL, false));
  return { properties, close: () => win.close() };
}

function createHappyDOM(requireFromTest: NodeJS.Require, packagePath: string, options: any): Environment {
  const { Window, GlobalWindow } = requireFromTest(packagePath);
  const win = new (GlobalWindow || Window)({
    ...options,
    console,
    url: options.url || "http://localhost:3000",
    settings: { ...options.settings, disableErrorCapturing: true },
  });
  // prettier-ignore
  const properties = windowProperties(win, [
    "Request", "Response", "MessagePort", "fetch", "Headers", "AbortController", "AbortSignal", "URL",
    "URLSearchParams", "FormData",
  ]);
  return {
    properties,
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
const kept = new Map<string, Environment>();

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
  let environment = kept.$get(id);
  if (!environment) {
    let options;
    try {
      options = optionsText === undefined ? undefined : JSON.parse(optionsText);
    } catch (error) {
      return `its options are not JSON: ${(error as Error).message}`;
    }
    environment = (name === "jsdom" ? createJSDOM : createHappyDOM)(requireFromTest, packagePath, options ?? {});
    if (keep) kept.$set(id, environment);
  }
  return environment;
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

  let environment;
  try {
    environment = open(name, optionsText, file, keep);
  } catch (error) {
    if (!isFromComment) throw error;
    environment = String((error as Error)?.message ?? error);
  }
  if (typeof environment === "string") {
    const message = `Cannot set up the "${name}" test environment of "${file}": ${environment}`;
    if (isFromComment) return message;
    const error = new Error(message);
    // Every frame would be of this file.
    captureStackTrace(error, setup);
    throw error;
  }

  const { properties, close } = environment;
  const originals: [string, PropertyDescriptor | undefined][] = [];
  for (const [key, descriptor] of properties) {
    const original = getOwnPropertyDescriptor(globalThis, key);
    if (original?.configurable === false) continue;
    originals.push([key, original]);
    defineProperty(globalThis, key, descriptor);
  }

  return function teardown() {
    for (const [key, original] of originals) {
      // What the file (or a preload) redefined is there again for the next file in this environment.
      const current = getOwnPropertyDescriptor(globalThis, key);
      if (current) properties.$set(key, current);
      else properties.$delete(key);

      if (original) tryDefineProperty(globalThis, key, original);
      else deleteProperty(globalThis, key);
    }
    if (!keep) return close();
  };
}

export default setup;
