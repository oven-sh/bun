// What `navigator` says about the machine.
const idl = require("internal/desktop/web/idl");

class NetworkInformation extends idl.EventTarget {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }
}
for (const [name, value] of Object.entries({ effectiveType: "4g", rtt: 50, downlink: 10, saveData: false })) {
  idl.attribute(NetworkInformation, name, () => value);
}
idl.defineHandlers(NetworkInformation.prototype, ["change"]);
idl.expose(NetworkInformation);

class Scheduling {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  isInputPending(options: any = undefined) {
    return idl.scope.page.host.native.isInputPending(!!idl.dictionary(options).includeContinuous);
  }
}
idl.expose(Scheduling);

class QuotaExceededError extends DOMException {
  #quota: number | null;
  #requested: number | null;

  constructor(message: unknown = "", options: any = undefined) {
    super(`${message}`, "QuotaExceededError");
    const { quota, requested } = idl.dictionary(options);
    this.#quota = quota === undefined ? null : idl.finite(quota);
    this.#requested = requested === undefined ? null : idl.finite(requested);
    if (this.#quota! < 0 || this.#requested! < 0 || (this.#requested !== null && this.#requested < this.#quota!)) {
      throw new RangeError("The quota or the requested amount is invalid.");
    }
  }

  get quota() {
    return this.#quota;
  }
  get requested() {
    return this.#requested;
  }
}
idl.expose(QuotaExceededError);

const opaque = () => "null " + crypto.randomUUID();
const tagOf = (value: unknown) => Object.prototype.toString.$call(value).slice(8, -1);
const hrefOfUrl = Object.getOwnPropertyDescriptor(URL.prototype, "href")!.get!;

function originOfUrl(href: unknown) {
  if (typeof href !== "string" || !URL.canParse(href)) return;
  const origin = idl.scope.env.originOf(href);
  return origin === "null" ? opaque() : origin;
}

function originOfPlatformObject(value: any) {
  const { env, isWindow } = idl.scope;
  if (value === globalThis) return env.origin === "null" ? "null " + env.token : env.origin;
  if (tagOf(value) === "URL") return originOfUrl(hrefOfUrl.$call(value));
  if (tagOf(value) === "MessageEvent") return require("internal/desktop/web/messaging").senderOf(value);
  if (!isWindow) return;
  const { core } = require("internal/desktop/web/dom");
  const node = core.nodeOf(value);
  if (!node) {
    const page = core.pageOfCallback(value);
    return page?.window === value ? page.host.origin : undefined;
  }
  if (node.name !== "a" && !core.isHtml(node, "area")) return;
  const href = node.ns === core.SVG ? core.svgHref(node) : core.getAttr(node, "href");
  if (href !== null) return originOfUrl(core.resolveUrl(node.doc, href));
}

class Origin {
  /** Or "null", a space, and what tells it from the others. */
  #serialized = opaque();

  static from(value: any) {
    idl.need(arguments.length, 1);
    const found = !$isObject(value)
      ? originOfUrl(value)
      : #serialized in value
        ? value.#serialized
        : originOfPlatformObject(value);
    if (found === undefined) throw new TypeError("The provided value has no origin.");
    const origin = new Origin();
    origin.#serialized = found;
    return origin;
  }

  get opaque() {
    return this.#serialized.startsWith("null ");
  }
  isSameOrigin(other: Origin) {
    return this.#serialized === other.#serialized;
  }
  isSameSite(other: Origin) {
    return this.#serialized === other.#serialized || idl.scope.env.isSameSite(this.#serialized, other.#serialized);
  }
}
idl.expose(Origin);

class Keyboard {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  /** There is no browser to take keys from. */
  async lock(codes: unknown = []) {
    idl.sequence(codes);
  }
  unlock() {}
}
idl.expose(Keyboard);

const brandsWith = (major: string, rest: string) =>
  Object.freeze(
    [
      { brand: "Not_A Brand", version: "24" + rest },
      { brand: "Chromium", version: major },
    ].map(Object.freeze),
  );

class NavigatorUAData {
  #version: string = idl.scope.env.chromeVersion;
  #brands = brandsWith(this.#version.split(".")[0], "");

  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  get brands() {
    return this.#brands;
  }
  get mobile() {
    return false;
  }
  get platform() {
    return process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";
  }
  toJSON() {
    return { brands: this.#brands, mobile: false, platform: this.platform };
  }
  async getHighEntropyValues(hints: unknown) {
    const wanted = idl.sequence(hints).map(String);
    const values = {
      architecture: process.arch === "arm64" ? "arm" : "x86",
      bitness: "64",
      formFactors: ["Desktop"],
      fullVersionList: brandsWith(this.#version, ".0.0.0"),
      model: "",
      platformVersion: wanted.includes("platformVersion") && (await idl.scope.env.systemVersion()),
      uaFullVersion: this.#version,
      wow64: false,
    };
    return {
      ...this.toJSON(),
      ...Object.fromEntries(Object.entries(values).filter(([name]) => wanted.includes(name))),
    };
  }
}
idl.expose(NavigatorUAData);

class External {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  AddSearchProvider() {}
  IsSearchProviderInstalled() {}
}
idl.expose(External);

export default {
  External,
  Keyboard,
  NavigatorUAData,
  NetworkInformation,
  Origin,
  QuotaExceededError,
  Scheduling,
  chrome: {},
  external: new External(idl.internal),
  webkitURL: URL,
  get WebKitMutationObserver() {
    return idl.scope.global.MutationObserver;
  },
};
