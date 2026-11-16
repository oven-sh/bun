// What a document loads: images, fonts, style sheets, scripts and frames.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const nodes = require("internal/desktop/dom/node");
const html = require("internal/desktop/dom/html");
const cssom = require("internal/desktop/dom/cssom");
const engine = require("internal/desktop/dom/engine");

const { asciiLower, domError, expose, flags, getAttr, hasAttr, invalidate, isHtml, resolveUrl, same } = core;
const { setAttr, splitTokens, sync, wrap } = core;
const { define, parseInteger } = html;
const { Sheet } = cssom;
const { CONNECTED } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;
type Sheet = $Dom.Sheet;
type Resource = {
  ok: boolean;
  status: number;
  url: string;
  mime: string;
  bytes: Uint8Array;
  charset?: string;
  isReadable?: boolean;
  referrerPolicy?: string;
};

async function fetchBuiltIn(url: string): Promise<Resource> {
  if (!/^(?:data|blob):/.test(url)) throw new TypeError("Failed to fetch");
  const response = await fetch(url);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0];
  return { ok: true, status: 200, url, mime, bytes: await response.bytes() };
}

/** Null if it failed. */
async function load(
  page: Page,
  url: string,
  destination: string,
  element?: N,
  more?: object,
): Promise<Resource | null> {
  const details = element && {
    nonce: nonceOf(element),
    initiator: element.name,
    referrerPolicy: hasAttr(element, "referrerpolicy") ? wrap(element).referrerPolicy : undefined,
    isQuirky: element.doc.quirks,
    parserInserted: element.x?.parserInserted,
    crossOrigin: getAttr(element, "crossorigin"),
    integrity: destination === "image" ? null : getAttr(element, "integrity"),
  };
  try {
    const resource = await (page.host.fetchResource?.(url, destination, { initiator: "css", ...details, ...more }) ??
      fetchBuiltIn(url));
    return resource.ok && !page.isDisposed ? resource : null;
  } catch {
    return null;
  }
}

const modifier = new RegExp('([a-z-]+)\\(\\s*"?([^")]*?)"?\\s*\\)', "gi");

/** What a style sheet says about how to request a URL. */
function requestOptions(modifiers: string | undefined, referrer: string | undefined = undefined) {
  if (modifiers === undefined) return undefined;
  const found = new Map<string, string>();
  for (const [, name, value] of modifiers.matchAll(modifier)) found.$set(asciiLower(name), value);
  const options: any = { crossOrigin: found.$get("cross-origin"), integrity: found.$get("integrity") };
  if (found.$has("referrer-policy")) options.referrerPolicy = asciiLower(found.$get("referrer-policy")!);
  if (referrer) options.referrer = referrer;
  return options;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function fireLater(page: Page, node: N, type: string) {
  page.delayLoad();
  page.queueTask(() => {
    events.fire(node, type);
    page.allowLoad();
  });
}

// ───────────────────────────── images ─────────────────────────────

const UNUSED_PIXELS = 4 << 20;
/** The ids of SVG images, which the engine paints, start here. */
const VECTOR = 2 ** 31;
const UNORIENTED = "unoriented:";
let lastVectorScope = VECTOR;

class Picture {
  page: Page;
  url: string;
  key: string;
  /** 0 until it is decoded. */
  id = 0;
  width = NaN;
  height = NaN;
  ratio = NaN;
  isSettled = false;
  isTainted = false;
  bytes = 0;
  loadedAt = 0;
  users = 0;
  done: Promise<void>;
  /** Of an SVG image. */
  parts: Picture[] = [];
  recorded = 0;
  fontScope = 0;

  constructor(page: Page, url: string, element?: N, density?: number) {
    this.page = page;
    this.url = url;
    this.key = pictureKey(url, element);
    this.done = density === undefined ? this.load(element) : this.open(density);
  }

  /** Has settled when it returns. */
  async open(density: number) {
    const { page, url } = this;
    const { native } = page;
    const start = url.indexOf(",") + 1;
    try {
      const bytes = Uint8Array.fromBase64(url.slice(start));
      if (Math.ceil(bytes.length / 3) * 4 !== url.length - start) return;
      const image = native.ask("image.open", { blob: native.putBlob(bytes), density, scale: page.scale });
      if (image === null) return;
      this.id = image.id;
      this.bytes = bytes.length;
      this.ratio = (this.width = image.width) / (this.height = image.height);
      this.isSettled = true;
      this.loadedAt = performance.now();
      if (bytes[0] === 0xff) this.correctDensity(bytes, true);
    } catch {}
  }

  async load(element?: N) {
    const { page } = this;
    const { native } = page;
    const isOriented = !this.url.startsWith(UNORIENTED);
    const [url, modifiers, base] = (isOriented ? this.url : this.url.slice(UNORIENTED.length)).split("\0");
    const options = requestOptions(modifiers, base === page.doc.baseUrl ? "" : base);
    const resource = page.host.loadsImages === false ? null : await load(page, url, "image", element, options);
    try {
      if (resource === null || native === null) return;
      this.bytes = resource.bytes.length;
      if (resource.mime.startsWith("image/svg+xml")) return await this.loadVector(resource.bytes, url);
      const image = await native.request("image.decode", { blob: native.putBlob(resource.bytes), isOriented });
      if (page.isDisposed) return native.send("image.release", { id: image.id });
      this.id = image.id;
      this.isTainted = resource.isReadable === false;
      this.width = image.width ?? NaN;
      this.height = image.height ?? NaN;
      this.ratio = image.ratio ?? this.width / this.height;
      if (resource.bytes[0] === 0xff) this.correctDensity(resource.bytes, isOriented);
    } catch {
    } finally {
      this.isSettled = true;
      this.loadedAt = performance.now();
      if (page.timings !== null) page.timings.hasNewImages = true;
      if (this.id === 0) page.pictures.$delete(this.key);
    }
  }

  /** https://html.spec.whatwg.org/#preferred-density-corrected-dimensions */
  correctDensity(bytes: Uint8Array, isOriented: boolean) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let at = 2;
    for (; view.getUint16(at) !== 0xffe1 || view.getUint32(at + 4) !== 0x45786966; at += 2 + view.getUint16(at + 2)) {
      if (bytes[at] !== 0xff || bytes[at + 1] < 0xe0 || bytes[at + 1] > 0xef) return;
    }
    const start = at + 10;
    const isLittle = bytes[start] === 0x49;
    const tags = new Map<number, number>();
    const read = (directory: number) => {
      for (let count = view.getUint16(directory, isLittle), entry = directory + 2; count > 0; count--, entry += 12) {
        const [type, value] = [view.getUint16(entry + 2, isLittle), view.getUint32(entry + 8, isLittle)];
        if (type < 3 || type > 5) continue;
        const number =
          type === 3
            ? view.getUint16(entry + 8, isLittle)
            : type === 4
              ? value
              : view.getUint32(start + value, isLittle) / view.getUint32(start + value + 4, isLittle);
        tags.$set(view.getUint16(entry, isLittle), number);
      }
    };
    read(start + view.getUint32(start + 4, isLittle));
    if (tags.$get(0x128) !== 2 || !tags.$has(0x8769)) return;
    read(start + tags.$get(0x8769)!);
    const axes = [
      [tags.$get(0xa002)!, tags.$get(0x11a)!],
      [tags.$get(0xa003)!, tags.$get(0x11b)!],
    ];
    const [[width, x], [height, y]] = isOriented && tags.$get(0x112)! > 4 ? axes.reverse() : axes;
    if (!(width > 0 && height > 0) || (this.width * 72) / x !== width || (this.height * 72) / y !== height) return;
    [this.width, this.height, this.ratio] = [width, height, width / height];
  }

  /** It gets nothing from outside of the file. */
  async loadVector(bytes: Uint8Array, url: string) {
    const { page } = this;
    const { engine } = page.doc;
    const scope = ++lastVectorScope;
    const [id, width, height, ratio] = engine.createVector(bytes, url, scope);
    for (let requests; !page.isDisposed && (requests = engine.takeVectorRequests(id)).length > 0;) {
      for (let i = 0; i < requests.length; i += 2) {
        const value = requests[i + 1];
        if (requests[i] === "image" && /^(?:unoriented:)?data:/.test(value)) {
          const part = usePicture(page, value);
          this.parts.push(part);
          await part.done;
          engine.setVectorImage(id, value, part.id, part.width, part.height, part.ratio);
        } else if (requests[i] === "image") engine.setVectorImage(id, value, 0, NaN, NaN, NaN);
        else if (requests[i] === "font") {
          const face = faceFromRule(value);
          const source = face.sources.find(it => it.url?.startsWith("data:"));
          const font = source && (await load(page, source.url!, "font"));
          if (!font || page.isDisposed) continue;
          this.fontScope = scope;
          try {
            face.registerIn(scope, page.native, { bytes: font.bytes });
          } catch {}
          engine.vectorFontsChanged(id);
        }
      }
    }
    this.id = id;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    if (page.isDisposed) this.free();
  }

  /** An id that the library knows. */
  libraryId(size: number[]): number {
    if (this.id < VECTOR) return this.id;
    return (this.recorded ||= this.page.doc.engine.recordVector(this.id, size[0], size[1]));
  }

  free() {
    const { native, doc } = this.page;
    const id = this.id < VECTOR ? this.id : this.recorded;
    if (id !== 0) native.send("image.release", { id });
    if (this.id < VECTOR) return;
    doc.engine.releaseVector(this.id);
    if (this.fontScope !== 0) native.send("font.dropScope", { scope: this.fontScope });
    for (const part of this.parts) part.release();
  }

  pixels() {
    return this.width * this.height || 0;
  }

  release() {
    const { page } = this;
    if (--this.users > 0 || page.isDisposed) return;
    const unused = page.unusedPictures;
    unused.$add(this);
    if (page.transition !== null) return;
    let pixels = 0;
    for (const it of unused) pixels += it.pixels();
    for (const it of unused) {
      if (pixels <= UNUSED_PIXELS) break;
      if (!it.isSettled) continue;
      pixels -= it.pixels();
      unused.$delete(it);
      page.pictures.$delete(it.key);
      it.free();
    }
  }
}
declare global {
  namespace $Dom {
    type Picture = PictureImpl;
    type Face = FaceImpl;
  }
}
type PictureImpl = Picture;
type FaceImpl = Face;

function corsMode(attribute: string | null): string {
  return attribute === null ? "" : asciiLower(attribute) === "use-credentials" ? "use-credentials " : "anonymous ";
}

function pictureKey(url: string, element?: N): string {
  return element === undefined ? url : corsMode(getAttr(element, "crossorigin")) + url;
}

function usePicture(page: Page, url: string, element?: N): Picture {
  let picture = page.pictures.$get(pictureKey(url, element));
  if (picture === undefined) page.pictures.$set((picture = new Picture(page, url, element)).key, picture);
  picture.users++;
  page.unusedPictures.$delete(picture);
  return picture;
}

class Img {
  picture: Picture | null = null;
  /** What it will show. */
  next: Picture | null = null;
  url = "";
  density = 1;
  /** The `width` and the `height` of a `<source>`. */
  size: (string | null)[] | null = null;
  isQueued = false;
  isBroken = false;
  hasAlt = false;
  serial = 0;
  loadedAt = 0;
  autoWidth = -1;
  deferred: Candidate | null = null;
  watchedBy: Page | null = null;
  stopDelaying: (() => void) | null = null;
  decoding: PromiseWithResolvers<void>[] | null = null;
  decodingFor: string | null = null;
}
const collectedImages = new FinalizationRegistry<Img>(it => {
  it.picture?.release();
  it.next?.release();
});

type Candidate = { url: string; density: number; width?: number };
const isFloat = /^-?(?:\d+|\d*\.\d+)(?:[eE][-+]?\d+)?$/;
const isCount = /^\d+$/;
const candidateUrl = /[\t\n\f\r ,]*([^\t\n\f\r ]*)/y;
const descriptorList = /((?:[^,(]|\([^)]*(?:\)|$))*),?/y;
const descriptor = /(?:[^\t\n\f\r (]|\([^)]*(?:\)|$))+/g;
const inlinePrefix = /^data:image\/(?:png|jpeg|webp);base64,/;
const isInline = (url: string | null) => url !== null && url.length > 8192 && inlinePrefix.test(url);
const startsWithAuto = /^auto(?:,|$)/i;
const isSupportedImage = /^(?:|image\/(?:png|apng|jpeg|gif|webp|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon))$/;

function parseDescriptors(url: string, descriptors: string[]): Candidate | null {
  const found: Record<string, number | undefined> = {};
  for (const it of descriptors) {
    const [unit, number] = [it.at(-1)!, it.slice(0, -1)];
    const isValid =
      unit === "x" ? isFloat.test(number) && +number >= 0 : "wh".includes(unit) && isCount.test(number) && +number > 0;
    if (!isValid || found[unit] !== undefined) return null;
    found[unit] = +number;
  }
  const { w, h, x } = found;
  if (x === undefined ? h !== undefined && w === undefined : w !== undefined || h !== undefined) return null;
  return { url, density: x ?? 1, width: w };
}

/** https://html.spec.whatwg.org/#parse-a-srcset-attribute */
function parseSourceSet(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (let at = 0; ;) {
    let url: string;
    if (at === 0 && isInline(text)) {
      at = text.length;
      for (const space of " \t\n\f\r") if (text.lastIndexOf(space, at) >= 0) at = text.indexOf(space);
      url = text.slice(0, at);
    } else {
      candidateUrl.lastIndex = at;
      url = candidateUrl.exec(text)![1];
      at = candidateUrl.lastIndex;
    }
    if (url === "") return candidates;
    let descriptors: string[] = [];
    let end = url.length;
    while (url[end - 1] === ",") end--;
    if (end === url.length) {
      descriptorList.lastIndex = at;
      descriptors = descriptorList.exec(text)![1].match(descriptor) ?? [];
      at = descriptorList.lastIndex;
    }
    const candidate = parseDescriptors(url.slice(0, end), descriptors);
    if (candidate !== null) candidates.push(candidate);
  }
}

const isLazy = (node: N) =>
  node.doc.page?.host.runsScripts !== false && asciiLower(getAttr(node, "loading") ?? "") === "lazy";
const allowsAutoSizes = (image: N) => isLazy(image) && startsWithAuto.test(getAttr(image, "sizes") ?? "");

function slotWidth(page: Page, image: N, from: N): number {
  const sizes = getAttr(from, from.name === "link" ? "imagesizes" : "sizes");
  if (allowsAutoSizes(image) && (sizes === null || startsWithAuto.test(sizes))) {
    page.autoSizedImages.$add(image);
    if (html.styleBits(image) & 1) return (image.x.autoWidth = page.doc.engine.boxSizes(image.id)[2]);
    if (image.x.autoWidth >= 0) return image.x.autoWidth;
  }
  return sync(page.doc).sourceSize(sizes ?? "");
}

function pickFromSet(page: Page, image: N, from: N, fallback: string | null): Candidate | null {
  const candidates = parseSourceSet(getAttr(from, from.name === "link" ? "imagesrcset" : "srcset") ?? "");
  const hasWidths = candidates.some(it => it.width !== undefined);
  const slot = hasWidths ? slotWidth(page, image, from) : 0;
  for (const it of candidates) if (it.width !== undefined) it.density = it.width / slot;
  if (fallback && !hasWidths) candidates.push({ url: fallback, density: 1 });
  const distinct = candidates.filter((it, i) => candidates.findIndex(other => other.density === it.density) === i);
  distinct.sort((a, b) => (a.density === b.density ? 0 : a.density - b.density));
  const wanted = distinct.findIndex(it => it.density >= page.scale);
  if (wanted < 0) return distinct.at(-1) ?? null;
  const isLoaded = ({ url }: Candidate) =>
    !url.startsWith("data:") && !!page.pictures.$get(pictureKey(resolveUrl(image.doc, url)!, image))?.id;
  return distinct.findLast((it, i) => i === wanted || (i > wanted && isLoaded(it)))!;
}

function isUsableSource(page: Page, node: N): boolean {
  if (!isHtml(node, "source") || !page.doc.engine.matchMedia(getAttr(node, "media") ?? "")) return false;
  if (
    !isSupportedImage.test(
      asciiLower(getAttr(node, "type") ?? "")
        .split(";")[0]
        .trim(),
    )
  )
    return false;
  return parseSourceSet(getAttr(node, "srcset") ?? "").length > 0;
}

function pickSource(page: Page, node: N): Candidate | null {
  for (let at = isHtml(node.parent, "picture") ? node.parent!.first : null; at !== null && at !== node; at = at.next) {
    if (isUsableSource(page, at)) return pickFromSet(page, node, at, null);
  }
  const src = getAttr(node, "src");
  return hasAttr(node, "srcset") ? pickFromSet(page, node, node, src) : src ? { url: src, density: 1 } : null;
}

const isResponsive = (node: N) => hasAttr(node, "srcset") || isHtml(node.parent, "picture");

function showImage(node: N) {
  const it: Img = node.x;
  if (node.id === 0) return;
  const { picture, density } = it;
  const { engine } = node.doc;
  const alt = picture === null && it.isBroken ? getAttr(node, "alt") : null;
  if (alt || it.hasAlt) {
    const root = node.rare?.shadow ?? core.attachShadow(node, true);
    core.replaceAllWithText(alt ?? "", root);
    it.hasAlt = !!alt;
  }
  if (alt) engine.clearReplaced(node.id);
  else if (picture === null) engine.setReplaced(node.id, 0, 0, 0, NaN);
  else engine.setReplaced(node.id, picture.id, picture.width / density, picture.height / density, picture.ratio);
  invalidate(node.doc);
}

function endDecoding(it: Img, isDecoded: boolean) {
  const { decoding } = it;
  if (decoding === null) return;
  it.decoding = null;
  for (const { resolve, reject } of decoding) {
    if (isDecoded) resolve();
    else reject(domError("EncodingError", "The source image cannot be decoded."));
  }
}

function settleImage(node: N, picture: Picture | null, url: string, density: number) {
  const it: Img = node.x;
  it.picture?.release();
  it.picture = picture?.id ? picture : null;
  it.next = null;
  it.url = url;
  it.density = density;
  it.isBroken = it.picture === null;
  it.loadedAt = performance.now();
  const timings = node.doc.page?.timings;
  if (timings) timings.hasNewImages = true;
  showImage(node);
}

function dropRequest(it: Img) {
  it.next?.release();
  it.next = null;
  it.deferred = null;
  it.stopDelaying?.();
  it.stopDelaying = null;
}

async function fetchImage(node: N, url: string, density: number, delaysLoad: boolean, isQuiet = false) {
  const it: Img = node.x;
  const page = node.doc.page!;
  const picture = (it.next = usePicture(page, url, node));
  if (delaysLoad) {
    page.delayLoad();
    it.stopDelaying = () => page.allowLoad();
  }
  await picture.done;
  page.queueTask(() => {
    if (it.next !== picture) return;
    const { stopDelaying } = it;
    it.stopDelaying = null;
    if (picture.id === 0 && isQuiet) it.next = null;
    else {
      settleImage(node, picture, url, density);
      endDecoding(it, picture.id !== 0);
      events.fire(node, picture.id !== 0 ? "load" : "error");
    }
    stopDelaying?.();
  });
}

/** https://html.spec.whatwg.org/#update-the-image-data */
function updateImage(node: N) {
  const it: Img = node.x;
  const page = node.doc.page;
  if (!it.isQueued) return;
  it.isQueued = false;
  if (page === null) return endDecoding(it, false);
  if (isResponsive(node) && it.watchedBy !== page) (it.watchedBy = page).responsiveImages.push(new WeakRef(node));
  if (it.size !== null) showSourceSize(node);
  const source = pickSource(page, node);
  const url = source && resolveUrl(node.doc, source.url);
  const { stopDelaying } = it;
  it.stopDelaying = null;
  dropRequest(it);
  if (url === null) {
    settleImage(node, null, source?.url ?? "", 1);
    endDecoding(it, false);
    if (source !== null || hasAttr(node, "src")) fireLater(page, node, "error");
  } else {
    if (it.picture === null) it.url = url;
    if (!isLazy(node)) fetchImage(node, url, source!.density, true);
    else {
      it.deferred = { url, density: source!.density };
      page.lazyImages.$add(node);
      invalidate(node.doc);
    }
  }
  stopDelaying?.();
}

async function updateSvgImage(node: N) {
  const it: Img = node.x;
  const page = node.doc.page;
  it.isQueued = false;
  if (page === null) return;
  const href = core.svgHref(node);
  const url = href ? resolveUrl(node.doc, href) : null;
  it.picture?.release();
  const picture = (it.picture = url === null ? null : usePicture(page, url, node));
  if (picture === null) return href === null || fireLater(page, node, "error");
  page.delayLoad();
  await picture.done;
  if (it.picture === picture) fireLater(page, node, picture.id !== 0 ? "load" : "error");
  page.allowLoad();
}

const svgImageHooks = {
  created: (node: N) => collectedImages.register(node, (node.x = new Img())),
  attribute(node: N, name: string) {
    if ((name !== "href" && name !== "crossorigin") || node.x.isQueued) return;
    node.x.isQueued = true;
    queueMicrotask(() => updateSvgImage(node));
  },
};

const svgImageMembers = {
  async decode(this: any) {
    const it: Img = this.$impl.x;
    await undefined;
    const { picture } = it;
    await picture?.done;
    if (!picture?.id || it.picture !== picture) throw domError("EncodingError", "The source image cannot be decoded.");
  },
};

/** Whether it has loaded. */
function loadExternalSvg(page: Page, url: string): Promise<boolean> {
  const all: Map<string, Promise<boolean>> = core.same(page.doc.node, "externalSvgs", () => new Map());
  let done = all.$get(url);
  if (done !== undefined) return done;
  page.delayLoad();
  done = load(page, url, "svg").then(resource => {
    if (page.isDisposed) return false;
    const isUsable = resource !== null && /[+/]xml\b/.test(resource.mime) && isSameOrigin(page, resource.url);
    page.doc.engine.setExternal(url, isUsable ? resource.bytes : new Uint8Array());
    invalidate(page.doc);
    page.allowLoad();
    return isUsable;
  });
  all.$set(url, done);
  return done;
}

async function updateUse(node: N) {
  const { page } = node.doc;
  const href = core.svgHref(node);
  const url = href && !href.startsWith("#") ? resolveUrl(node.doc, href)?.split("#")[0] : undefined;
  if (page === null || url === undefined || url === node.doc.url.split("#")[0] || !(node.flags & flags.CONNECTED))
    return;
  page.delayLoad();
  const isLoaded = !url.startsWith("data:") && (await loadExternalSvg(page, url));
  if (core.svgHref(node) === href) fireLater(page, node, isLoaded ? "load" : "error");
  page.allowLoad();
}

const useHooks = {
  inserted: updateUse,
  attribute: (node: N, name: string) => name === "href" && updateUse(node),
};

/** A large image in a `data:` URL is available at once, so that it is decoded while the page gets ready to show it. */
function openInline(page: Page, node: N): Candidate | null {
  const set = getAttr(node, "srcset");
  if (!isInline(set ?? getAttr(node, "src")) || isHtml(node.parent, "picture")) return null;
  if (set !== null && parseSourceSet(set).some(it => it.width !== undefined)) return null;
  const source = pickSource(page, node);
  if (source === null || !isInline(source.url)) return null;
  if (page.pictures.$has(pictureKey(source.url, node))) return source;
  if (page.native === null || page.host.loadsImages === false || page.host.allowsInlineImages?.() === false)
    return null;
  const picture = new Picture(page, source.url, node, source.density);
  if (picture.id === 0) return null;
  page.pictures.$set(picture.key, picture);
  return source;
}

function queueImageUpdate(node: N) {
  const it: Img = node.x;
  const page = node.doc.page;
  if (page === null) {
    endDecoding(it, false);
    return dropRequest(it);
  }
  const inline = openInline(page, node);
  const src = inline !== null || isResponsive(node) ? null : getAttr(node, "src");
  const url = inline?.url ?? (src && resolveUrl(node.doc, src));
  const known = url ? page.pictures.$get(pictureKey(url, node)) : undefined;
  if (known?.id) {
    if (isResponsive(node) && it.watchedBy !== page) (it.watchedBy = page).responsiveImages.push(new WeakRef(node));
    const serial = ++it.serial;
    it.isQueued = false;
    const picture = usePicture(page, known.url, node);
    if (picture !== it.picture) endDecoding(it, false);
    dropRequest(it);
    settleImage(node, picture, known.url, inline?.density ?? 1);
    page.delayLoad();
    return page.queueTask(() => {
      if (serial === it.serial) events.fire(node, "load");
      page.allowLoad();
    });
  }
  if (!it.picture || getAttr(node, "src") !== it.decodingFor) endDecoding(it, false);
  it.serial++;
  if (it.isQueued) return;
  it.isQueued = true;
  queueMicrotask(() => updateImage(node));
}

function resumeImage(node: N) {
  const it: Img = node.x;
  const source = (allowsAutoSizes(node) && pickSource(node.doc.page!, node)) || null;
  const { url, density } = it.deferred!;
  it.deferred = null;
  fetchImage(node, (source && resolveUrl(node.doc, source.url)) ?? url, source?.density ?? density, false);
}

/** https://html.spec.whatwg.org/#reacting-to-environment-changes */
function reselectImage(page: Page, node: N) {
  const it: Img = node.x;
  if (node.doc.page !== page || it.isQueued || it.deferred !== null || !isResponsive(node)) return;
  const source = pickSource(page, node);
  const url = source && resolveUrl(node.doc, source.url);
  if (url === null || url === (it.next?.url ?? (it.density === source!.density ? it.url : null))) return;
  if (url === it.url && it.picture !== null) {
    dropRequest(it);
    it.density = source!.density;
    return showImage(node);
  }
  const delaysLoad = it.stopDelaying !== null;
  dropRequest(it);
  if (it.picture === null) it.url = url;
  fetchImage(node, url, source!.density, delaysLoad, it.picture !== null || it.isBroken);
}

function reselectImages(page: Page) {
  page.responsiveImages = page.responsiveImages.filter(it => it.deref()?.x.watchedBy === page);
  for (const it of page.responsiveImages) reselectImage(page, it.deref()!);
}

function reselectAutoSizedImages(page: Page) {
  for (const node of Array.from(page.autoSizedImages)) {
    if (!(node.flags & CONNECTED) || !allowsAutoSizes(node)) page.autoSizedImages.$delete(node);
    else if (page.doc.engine.boxSizes(node.id)[2] !== node.x.autoWidth) reselectImage(page, node);
  }
}

const nearMargins = [1250, 0, 1250, 0, 1250, 0, 1250, 0, 600, 0, 600, 0, 600, 0, 600, 0];
function isNear(node: N): boolean {
  return (html.layout(node)?.intersection(node.id, 1, nearMargins)[0] ?? 0) !== 0;
}

function loadLazyImages(page: Page) {
  for (const node of page.lazyImages) {
    const waits = node.flags & CONNECTED && node.doc === page.doc && node.x.deferred !== null;
    if (waits && !(page.width > 0 && isNear(node))) continue;
    page.lazyImages.$delete(node);
    if (waits) resumeImage(node);
  }
}

function naturalSize({ picture, density }: Img): [number, number] {
  if (picture === null) return [0, 0];
  let { width, height, ratio } = picture;
  if (width !== width && height !== height) {
    return ratio > 2 ? [300, Math.round(300 / ratio)] : ratio > 0 ? [Math.round(150 * ratio), 150] : [300, 150];
  }
  if (width !== width && !(ratio > 0)) return [300, Math.round(height / density)];
  if (height !== height && !(ratio > 0)) return [Math.round(width / density), 150];
  if (width !== width) width = height * ratio;
  else if (height !== height) height = width / ratio;
  return [Math.round(width / density), Math.round(height / density)];
}

function imageSize(node: N, name: string, axis: number): number {
  if (html.styleBits(node) & 1) {
    return Math.round((node.x.hasAlt ? html.boundingRect(node) : node.doc.engine.boxSizes(node.id))[2 + axis]);
  }
  const size = parseInteger(getAttr(node, name));
  return size >= 0 ? size : naturalSize(node.x)[axis];
}

function showButtonImage(node: N) {
  if (node.id === 0) return;
  const { picture } = node.x.image as Img;
  if (picture === null) node.doc.engine.clearReplaced(node.id);
  else node.doc.engine.setReplaced(node.id, picture.id, picture.width, picture.height, picture.ratio);
  invalidate(node.doc);
}

function updateButtonImage(node: N) {
  const { page } = node.doc;
  if (node.x.image === null) collectedImages.register(node, (node.x.image = new Img()));
  const it: Img = node.x.image;
  if (it.isQueued || page === null) return;
  it.isQueued = true;
  page.delayLoad();
  queueMicrotask(async () => {
    it.isQueued = false;
    const src = node.x.type === "image" ? getAttr(node, "src") : null;
    const url = src ? core.resolveUrl(node.doc, src) : null;
    it.next?.release();
    const next = (it.next = url === null ? null : usePicture(page, url, node));
    await next?.done;
    if (it.next === next) {
      it.picture?.release();
      it.picture = next?.id ? next : null;
      it.next = null;
      showButtonImage(node);
      if (src !== null) fireLater(page, node, it.picture === null ? "error" : "load");
    }
    page.allowLoad();
  });
}

function buttonSize(node: N, name: string, axis: number): number {
  if (node.x.type !== "image") return 0;
  if (html.styleBits(node) & 1) return Math.round(node.doc.engine.boxSizes(node.id)[2 + axis]);
  const size = parseInteger(getAttr(node, name));
  return size >= 0 ? size : node.x.image === null ? 0 : naturalSize(node.x.image)[axis];
}

const isReferrerPolicy =
  /^(?:no-referrer(?:-when-downgrade)?|(?:same|strict)-origin|(?:strict-)?origin-when-cross-origin|origin|unsafe-url)$/;
function referrerPolicy(attribute: string | null): string {
  const policy = asciiLower(attribute ?? "");
  return isReferrerPolicy.test(policy) ? policy : "";
}

function imageAttributeChanged(node: N, name: string, old: string | null, value: string | null) {
  switch (name) {
    case "src":
    case "srcset":
    case "sizes":
      return queueImageUpdate(node);
    case "crossorigin":
      return corsMode(old) === corsMode(value) || queueImageUpdate(node);
    case "referrerpolicy":
      return referrerPolicy(old) === referrerPolicy(value) || queueImageUpdate(node);
    case "loading":
      if (node.x.deferred !== null && !isLazy(node)) resumeImage(node);
      else if (node.doc.page !== null) reselectImage(node.doc.page, node);
      return;
    case "width":
      return allowsAutoSizes(node) && queueImageUpdate(node);
    case "alt":
      return showImage(node);
  }
}

const HTMLImageElement = define(
  "HTMLImageElement",
  "img",
  `alt src@ srcset sizes crossOrigin useMap isMap? referrerPolicy decoding loading fetchPriority name lowsrc@ align
  hspace+0 vspace+0 longDesc@ border!`,
  () => ({
    get width() {
      return imageSize((this as any).$impl, "width", 0);
    },
    set width(value) {
      setAttr((this as any).$impl, "width", String(Math.max(value | 0, 0)));
      core.react();
    },
    get height() {
      return imageSize((this as any).$impl, "height", 1);
    },
    set height(value) {
      setAttr((this as any).$impl, "height", String(Math.max(value | 0, 0)));
      core.react();
    },
    get naturalWidth() {
      return naturalSize((this as any).$impl.x)[0];
    },
    get naturalHeight() {
      return naturalSize((this as any).$impl.x)[1];
    },
    get complete() {
      const node: N = (this as any).$impl;
      const it: Img = node.x;
      if (!hasAttr(node, "srcset") && !getAttr(node, "src")) return true;
      return !it.isQueued && it.next === null && it.deferred === null && (it.picture !== null || it.isBroken);
    },
    get currentSrc() {
      return (this as any).$impl.x.url;
    },
    get x() {
      return html.metric((this as any).$impl, (this as any).$impl.id, 15);
    },
    get y() {
      return html.metric((this as any).$impl, (this as any).$impl.id, 16);
    },
    decode(this: any) {
      const node: N = this.$impl;
      const it: Img = node.x;
      const waiting = Promise.withResolvers<void>();
      (it.decoding ??= []).push(waiting);
      it.decodingFor = getAttr(node, "src");
      queueMicrotask(() => {
        const isActive = node.doc.page?.isDisposed === false;
        if (!isActive || (it.next === null && it.deferred === null)) endDecoding(it, isActive && it.picture !== null);
      });
      return waiting.promise;
    },
  }),
  {
    created: (node: N) => collectedImages.register(node, (node.x = new Img())),
    mirrored(node: N) {
      showImage(node);
      if (node.x.size !== null) showSourceSize(node);
    },
    attribute: imageAttributeChanged,
    inserted(node: N) {
      if (node.x.deferred !== null) node.doc.page?.lazyImages.$add(node);
      node.x.loadedAt &&= performance.now();
    },
    moved(node: N, old: N | null) {
      if (!isHtml(old ?? node.parent, "picture")) return;
      showSourceSize(node);
      queueImageUpdate(node);
    },
    adopted: queueImageUpdate,
  },
);

function Image(width?: number, height?: number) {
  const node = core.createPlainElement(core.realm.page.doc, "img", core.HTML);
  if (width !== undefined) setAttr(node, "width", String(width >>> 0));
  if (height !== undefined) setAttr(node, "height", String(height >>> 0));
  return wrap(node);
}
html.defineFactory("Image", Image, HTMLImageElement);

/** https://html.spec.whatwg.org/#concept-img-dimension-attribute-source */
function showSourceSize(node: N) {
  const it: Img = node.x;
  const { page, engine } = node.doc;
  let source = page !== null && isHtml(node.parent, "picture") ? node.parent!.first : null;
  while (source !== null && source !== node && !isUsableSource(page!, source)) source = source.next;
  it.size = ["width", "height"].map(name => (source === null || source === node ? null : getAttr(source, name)));
  if (node.id === 0) return;
  ["width source", "height source"].forEach((name, i) => {
    if (it.size![i] === null) engine.removeAttribute(node.id, name);
    else engine.setAttribute(node.id, name, it.size![i]);
  });
  invalidate(node.doc);
}

function sourceChanged(parent: N | null, from: N | null, isOnlySize = false) {
  if (!isHtml(parent, "picture")) return;
  for (let at = from; at !== null; at = at.next) {
    if (!isHtml(at, "img")) continue;
    showSourceSize(at);
    if (!isOnlySize) queueImageUpdate(at);
  }
}
const sourceAttributes = new Set(["srcset", "sizes", "media", "type"]);
define("HTMLSourceElement", "source", "src@ type srcset sizes media width+0 height+0", undefined, {
  attribute(node: N, name: string) {
    const isSize = name === "width" || name === "height";
    if (isSize || sourceAttributes.$has(name)) sourceChanged(node.parent, node, isSize);
  },
  moved: (node: N, old: N | null) => sourceChanged(old ?? node.parent, old?.first ?? node),
});

// ───────────────────────────── canvas ─────────────────────────────

let canvasModule: any;

function flushCanvases() {
  canvasModule?.flush();
}

function canvas() {
  if (canvasModule !== undefined) return canvasModule;
  const loaded = (canvasModule = require("internal/desktop/dom/canvas"));
  const { kImageId, kImageSize, kIsTainted } = loaded;
  const { native } = core.realm.page;
  if (native === null) throw domError("NotSupportedError", "This window cannot draw.");
  loaded.setNative(native);
  loaded.hooks.isFocused = (element: any, fallback: unknown) => {
    const node = core.unwrap(fallback, "drawFocusIfNeeded");
    return node.doc.focused === node && element.contains(fallback);
  };
  loaded.hooks.useFont = (element: any, font: object) =>
    useFont(core.nodeOf(element)?.doc.page ?? core.realm.page, font);
  loaded.hooks.inherited = (element: any) => {
    const node = core.nodeOf(element);
    const { doc, fontScope } = node?.doc.page ?? core.realm.page;
    const engine = node && node.flags & CONNECTED ? sync(node.doc) : null;
    const style = (of: N | null, name: string) => (engine && of?.id ? engine.computedStyle(of.id, "", name) : "");
    let withLanguage = node;
    while (withLanguage !== null && !hasAttr(withLanguage, "lang")) withLanguage = core.parentOrHost(withLanguage);
    return {
      fontSize: parseFloat(style(node, "font-size")) || 10,
      rootFontSize: parseFloat(style(core.documentElement(doc), "font-size")) || 16,
      direction: style(node, "direction") || "ltr",
      color: style(node, "color") || "#000",
      language: (withLanguage && getAttr(withLanguage, "lang")) ?? "",
      fontScope,
    };
  };
  const source = (
    lazy: $Dom.Interface,
    id: (node: N) => number,
    size: (node: N) => number[],
    isTainted?: (node: N) => unknown,
  ) =>
    Object.defineProperties(lazy.load().prototype, {
      [kImageId]: {
        get() {
          return id(this.$impl);
        },
      },
      [kImageSize]: {
        get() {
          return size(this.$impl);
        },
      },
      [kIsTainted]: {
        get() {
          return isTainted?.(this.$impl);
        },
      },
    });
  const pixels = ({ x }: N) => naturalSize(x).map(size => size * x.density);
  const idOfImage = (node: N) => {
    const { picture, isBroken, isQueued, next, url }: Img = node.x;
    if (isQueued) return picture !== null && picture.url === node.js.src ? picture.libraryId(pixels(node)) : 0;
    if (isBroken && url !== "" && next === null)
      throw domError("InvalidStateError", "The image is in the 'broken' state.");
    return picture?.libraryId(pixels(node)) ?? 0;
  };
  source(HTMLImageElement, idOfImage, pixels, node => node.x.picture?.isTainted);
  source(
    HTMLCanvasElement,
    node => (node.x.type === "offscreen" && node.x.presented) || backingOf(node)[kImageId],
    node => node.x.size ?? canvasSize(node),
    node => node.x.backing?.[kIsTainted],
  );
  source(
    HTMLVideoElement,
    node => node.x.frames[0] ?? 0,
    node => [node.x.videoWidth, node.x.videoHeight],
    node => node.x.player(false)?.isTainted,
  );
  return loaded;
}

class Canvas {
  /** The context that holds the pixels. */
  backing: any = null;
  type = "";
  /** The image that an `OffscreenCanvas` has sent, and its size. */
  presented = 0;
  ownsPresented = false;
  size: number[] | null = null;
}

function canvasSize(node: N): [number, number] {
  const [width, height] = [parseInteger(getAttr(node, "width")), parseInteger(getAttr(node, "height"))];
  return [width >= 0 ? width : 300, height >= 0 ? height : 150];
}

function showCanvas(node: N) {
  if (node.id === 0) return;
  const { backing, presented }: Canvas = node.x;
  const [width, height] = canvasSize(node);
  node.doc.engine.setReplaced(
    node.id,
    presented || (backing?.[canvasModule.kImageId] ?? 0),
    width,
    height,
    width / height,
  );
  invalidate(node.doc);
}

function backingOf(node: N, settings?: object) {
  const it: Canvas = node.x;
  if (it.backing === null) {
    it.backing = canvas().createContext(wrap(node), settings);
    showCanvas(node);
  }
  return it.backing;
}

function pixelsOf(node: N) {
  const { type, size }: Canvas = node.x;
  if (type !== "offscreen" || size === null) return backingOf(node);
  const copy = canvasModule.createContext({ width: size[0], height: size[1] });
  if (size[0] * size[1] > 0) copy.drawImage(node.js, 0, 0);
  return copy;
}

const HTMLCanvasElement = define(
  "HTMLCanvasElement",
  "canvas",
  "width+300 height+150",
  () => ({
    getContext(this: any, type: string, settings: any = undefined) {
      if ($argumentCount() < 1) core.tooFew(1);
      const node: N = this.$impl;
      if (arguments.length === 0) throw new TypeError("1 argument required, but only 0 present.");
      type = `${type}`;
      const it: Canvas = node.x;
      if (it.type === "offscreen")
        throw domError("InvalidStateError", "Control was transferred to an OffscreenCanvas.");
      if ((type !== "2d" && type !== "bitmaprenderer") || (it.type || type) !== type) return null;
      if (core.realm.page.native === null) return null;
      if (it.type === "") it.backing = null;
      const context = backingOf(node, settings);
      it.type = type;
      return type === "2d" ? context : same(node, type, () => canvasModule.createRenderer(context));
    },
    toDataURL(this: any, type: any = undefined, quality: unknown = undefined) {
      const { encodedType, kEncodeSync } = canvas();
      const bytes = pixelsOf(this.$impl)[kEncodeSync]((type = encodedType(type)), quality);
      return bytes === null ? "data:," : `data:${type};base64,${bytes.toString("base64")}`;
    },
    toBlob(this: any, callback: Function, type: any = undefined, quality: unknown = undefined) {
      if (!$isCallable(callback)) throw new TypeError("parameter 1 is not of type 'Function'.");
      const { encodedType, kEncode, kIsTainted } = canvas();
      if (this[kIsTainted]) throw domError("SecurityError", "Tainted canvases may not be exported.");
      pixelsOf(this.$impl)
        [kEncode]((type = encodedType(type)), quality)
        .then(bytes => {
          const blob = bytes && new Blob([new Uint8Array(bytes)], { type });
          events.callBack(this.$impl.doc.page, callback, undefined, blob);
        });
    },
    transferControlToOffscreen(this: any) {
      const it: Canvas = this.$impl.x;
      if (it.type !== "") throw domError("InvalidStateError", "The canvas already has a rendering context.");
      it.type = "offscreen";
      return canvas().createOffscreen(this.width, this.height, (id, width, height, isOwned) => {
        if (it.ownsPresented) core.realm.page.native.send("image.release", { id: it.presented });
        if (id === it.presented && width === it.size?.[0] && height === it.size[1]) return;
        it.presented = id;
        it.ownsPresented = isOwned && id !== 0;
        it.size = [width, height];
        queueMicrotask(() => {
          setAttr(this.$impl, "width", String(width));
          setAttr(this.$impl, "height", String(height));
        });
      });
    },
  }),
  {
    created: (node: N) => (node.x = new Canvas()),
    mirrored: showCanvas,
    attribute(node: N, name: string) {
      if (name !== "width" && name !== "height") return;
      if (node.x.type !== "bitmaprenderer") node.x.backing?.[canvasModule.kResize](...canvasSize(node));
      showCanvas(node);
    },
  },
);

// ───────────────────────────── fonts ─────────────────────────────

const descriptors = {
  family: "",
  style: "normal",
  weight: "normal",
  stretch: "normal",
  unicodeRange: "U+0-10FFFF",
  variant: "normal",
  featureSettings: "normal",
  variationSettings: "normal",
  display: "auto",
  ascentOverride: "normal",
  descentOverride: "normal",
  lineGapOverride: "normal",
  sizeAdjust: "100%",
};
type Descriptors = typeof descriptors;
type FontSource = { url?: string; local?: string; bytes?: Uint8Array };

const fraction = (text: string) => (text.endsWith("%") ? parseFloat(text) / 100 : undefined);
const unquote = (text: string) => text.trim().replace(/^(["'])(.*)\1$/s, "$2");

const keywords = {
  __proto__: null,
  "bold": 700,
  "ultra-condensed": 50,
  "extra-condensed": 62.5,
  "condensed": 75,
  "semi-condensed": 87.5,
  "semi-expanded": 112.5,
  "expanded": 125,
  "extra-expanded": 150,
  "ultra-expanded": 200,
};

function pair(text: string, normal: number): number[] {
  const [first, second = first] = splitTokens(text).map(it => keywords[it] ?? (parseFloat(it) || normal));
  return [first, second];
}

function settings(text: string): [string, number][] {
  return Array.from(text.matchAll(/["'](.{4})["']\s*([^,\s]*)/g), ([, tag, value]) => [
    tag,
    value === "off" ? 0 : value === "on" || value === "" ? 1 : +value,
  ]);
}

function parseRanges(text: string): number[][] {
  return Array.from(text.matchAll(/u\+([\da-f?]+)(?:-([\da-f]+))?/gi), ([, first, last = first]) => [
    parseInt(first.replaceAll("?", "0"), 16),
    parseInt(last.replaceAll("?", "f"), 16),
  ]);
}

const withPrefix = new Set(splitTokens("style weight stretch variant featureSettings variationSettings display"));

/** `null` if it is invalid. */
function validDescriptor(name: string, value: string): string | null {
  const dashed = name.replace(/[A-Z]/g, it => "-" + it.toLowerCase());
  const parse = (text: string) =>
    engine.expandDeclaration(
      "font-face",
      (name === "family" || withPrefix.$has(name) ? "font-" : "") + dashed,
      text,
      false,
    )[2];
  return parse(value) ?? (name === "family" ? parse(JSON.stringify(value)) : undefined) ?? null;
}

/** For the blank windows that a page opens: they have its realm and its policies. */
const fontsOfWindows = new Map<string, Uint8Array>();

class Face {
  js: object;
  values: Descriptors;
  sources: FontSource[];
  status = "unloaded";
  /** The descriptors that are up to the font. */
  autos: string[] = [];
  loaded = Promise.withResolvers<object>();
  /** The one that loaded. */
  source: FontSource | null = null;
  /** The ids in the library. */
  registered = new Map<Page, number>();
  isFromCss = false;
  /** The highest one wins. */
  order = 0x7fffffff;

  constructor(js: object, values: Descriptors, sources: FontSource[]) {
    this.js = js;
    this.values = values;
    this.sources = sources;
    $pokePromiseAsHandled(this.loaded.promise);
  }

  registerIn(scope: number, native: any, { local, bytes }: FontSource): number {
    const it = this.values;
    return native.ask("font.register", {
      scope,
      family: unquote(it.family),
      ...(bytes ? { blob: native.putBlob(bytes) } : { local }),
      weight: this.autos.includes("weight") ? undefined : pair(it.weight, 400),
      stretch: this.autos.includes("stretch") ? undefined : pair(it.stretch, 100),
      style: this.autos.includes("style") ? undefined : it.style.split(" ")[0],
      slope: it.style.startsWith("oblique ") ? pair(it.style.slice(8), 0) : undefined,
      order: this.order,
      unicodeRange: it.unicodeRange === descriptors.unicodeRange ? undefined : parseRanges(it.unicodeRange),
      sizeAdjust: fraction(it.sizeAdjust),
      ascentOverride: fraction(it.ascentOverride),
      descentOverride: fraction(it.descentOverride),
      lineGapOverride: fraction(it.lineGapOverride),
      features: settings(it.featureSettings),
      variations: settings(it.variationSettings),
    });
  }

  distance(weight: number, isItalic: boolean): number {
    const range = pair(this.values.weight, 400);
    const lighter = Math.max(weight - Math.max(...range), 0);
    const heavier = Math.max(Math.min(...range) - weight, 0);
    const against = weight > 500 ? lighter : weight < 400 || weight + heavier > 500 ? heavier : 0;
    const slants = !/^(?:normal|auto)$/.test(this.values.style);
    return (
      +(slants !== isItalic) * 4000 +
      +(against > 0) * 1000 +
      +(weight >= 400 && weight <= 500 && lighter > 0) * 500 +
      lighter +
      heavier
    );
  }

  covers(points: number[]): boolean {
    const ranges = parseRanges(this.values.unicodeRange);
    return points.length === 0 || points.some(it => ranges.some(([from, to]) => from <= it && it <= to));
  }

  /** Tells the library which of the pages have it. */
  publish() {
    for (const [page, id] of this.registered) {
      if (page.isDisposed) continue;
      if (id !== 0) page.native.send("font.unregister", { id });
      if (this.source === null || page.native === null) continue;
      this.registered.$set(page, this.registerIn(page.fontScope, page.native, this.source));
      fontsChanged(page);
    }
  }

  fail(message: string) {
    this.status = "error";
    this.loaded.reject(domError("SyntaxError", message));
  }

  async load(page: Page) {
    if (this.status !== "unloaded") return;
    this.status = "loading";
    for (const user of this.registered.keys()) fontsOf(user).started(this);
    for (const source of this.sources) {
      const isShared = source.url !== undefined && page.container === null && page.mirror === null;
      let bytes = isShared ? fontsOfWindows.$get(source.url!) : source.bytes;
      if (bytes === undefined && source.url !== undefined) {
        bytes = (await load(page, source.url, "font"))?.bytes;
        if (isShared && bytes !== undefined && fontsOfWindows.size < 4) fontsOfWindows.$set(source.url, bytes);
      }
      if (page.isDisposed || (bytes === undefined && source.local === undefined)) continue;
      const { native } = page;
      if (bytes !== undefined && native !== null && !native.ask("font.decode", native.putBlob(bytes))) {
        await native.request("font.decode", native.putBlob(bytes));
        if (page.isDisposed) continue;
      }
      try {
        this.source = { bytes, local: source.local };
        if (this.registered.size > 0) this.publish();
        else page.native?.send("font.unregister", { id: this.registerIn(0xffffffff, page.native, this.source) });
        break;
      } catch {
        this.source = null;
      }
    }
    this.status = this.source === null ? "error" : "loaded";
    if (this.isFromCss) this.source = null;
    if (this.status === "loaded") this.loaded.resolve(this.js);
    else if (this.sources[0]?.bytes !== undefined) this.fail("Invalid font data in ArrayBuffer.");
    else this.loaded.reject(domError("NetworkError", "A network error occurred."));
    for (const user of this.registered.keys()) fontsOf(user).finished(this);
  }
}

function fontsChanged(page: Page) {
  if (page.doc.page === null) return;
  page.doc.engine.fontsChanged();
  invalidate(page.doc);
}

const fontSource = new RegExp('^(url|local)\\("((?:[^"\\\\]|\\\\.)*)"', "s");
const unsupportedFormat = new RegExp(
  '\\) format\\((?!"?(?:collection|(?:opentype|truetype|woff2?)(?:-variations)?)"?\\))',
  "i",
);
const escaped = new RegExp("\\\\(.)", "gs");

class FontFace {
  declare $impl: Face;

  constructor(family: string, source: string | ArrayBuffer | ArrayBufferView, given: object | undefined = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    const { page } = core.realm;
    const values = { ...descriptors };
    let invalid = "";
    for (const name in descriptors) {
      const value = name === "family" ? family : given?.[name];
      if (value === undefined) continue;
      const valid = validDescriptor(name, `${value}`);
      if (valid === null) invalid = `${value}`;
      values[name] = valid ?? "";
    }
    const isBinary = ArrayBuffer.isView(source) || source instanceof ArrayBuffer;
    const src = isBinary ? "" : validDescriptor("src", `${source}`);
    if (invalid !== "" || src === null) {
      this.$impl = new Face(this, values, []);
      this.$impl.fail(`Failed to set '${invalid || source}' as a property value.`);
      return;
    }
    if (!isBinary) {
      const found = engine.splitValue(src, true).filter((it: string) => !unsupportedFormat.test(it));
      const sources = found.map((it: string) => {
        const [, kind, value] = fontSource.exec(it)!;
        return kind === "url"
          ? {
              url:
                resolveUrl(
                  page.doc,
                  value.replace(escaped, (_, it) => it),
                ) ?? "",
            }
          : { local: value };
      });
      this.$impl = new Face(this, values, sources);
      return;
    }
    const bytes = ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source);
    this.$impl = new Face(this, values, [{ bytes: bytes.slice() }]);
    this.$impl.load(page);
  }
  get status() {
    return this.$impl.status;
  }
  get loaded() {
    if (!(this?.$impl instanceof Face)) return Promise.$reject(new TypeError("Illegal invocation"));
    return this.$impl.loaded.promise;
  }
  load() {
    if (!(this?.$impl instanceof Face)) return Promise.$reject(new TypeError("Illegal invocation"));
    this.$impl.load(core.realm.page);
    return this.loaded;
  }
}
for (const name in descriptors) {
  core.accessor(
    FontFace.prototype,
    name,
    function (this: FontFace) {
      return this.$impl.values[name];
    },
    function (this: FontFace, value) {
      const { values } = this.$impl;
      const valid = validDescriptor(name, `${value}`);
      if (valid === null) throw domError("SyntaxError", `Failed to set '${value}' as a property value.`);
      values[name] = valid;
      this.$impl.publish();
    },
  );
}
expose(FontFace);

class Fonts {
  page: Page;
  js: FontFaceSet;
  faces = new Set<object>();
  fromCss = new Map<string, Face>();
  /** The rules, until a script wants to see them. */
  rules: string | null = null;
  lastRules = "";
  loading = new Set<Face>();
  done: Face[] = [];
  ready = Promise.withResolvers<object>();

  constructor(page: Page) {
    this.page = page;
    this.js = new FontFaceSet(this);
    if (page.doc.readyState === "complete") this.ready.resolve(this.js);
  }

  add(face: Face) {
    if (this.faces.$has(face.js)) return;
    this.faces.$add(face.js);
    face.registered.$set(this.page, 0);
    if (face.status === "loading") this.started(face);
    else if (face.status === "loaded") face.publish();
    else if (!face.isFromCss) face.load(this.page);
  }

  setRules(rules: string) {
    this.rules = rules;
    this.lastRules = rules;
    for (const [rule, face] of this.fromCss) {
      const order = rules.lastIndexOf(rule);
      if (order < 0 && this.fromCss.$delete(rule)) this.remove(face);
      if (order < 0 || order === face.order) continue;
      face.order = order;
      const id = face.registered.$get(this.page);
      if (id && this.page.native.ask("font.order", { id, order })) fontsChanged(this.page);
    }
  }

  faceFor(rule: string): Face {
    let face = this.fromCss.$get(rule);
    if (face === undefined) {
      this.fromCss.$set(rule, (face = faceFromRule(rule)));
      face.order = Math.max(this.lastRules.lastIndexOf(rule), 0);
      this.add(face);
    }
    return face;
  }

  /** Those of style sheets come first. */
  all(): Set<object> {
    takeRequests(this.page);
    if (this.rules === null) return this.faces;
    const rules = this.rules === "" ? [] : this.rules.split("\n");
    this.rules = null;
    const ordered = rules.map(it => this.faceFor(it).js);
    for (const face of this.faces) if (!(face as FontFace).$impl.isFromCss) ordered.push(face);
    this.faces.clear();
    for (const face of ordered) this.faces.$add(face);
    return this.faces;
  }

  remove(face: Face): boolean {
    const id = face.registered.$get(this.page);
    if (id === undefined) return false;
    this.faces.$delete(face.js);
    face.registered.$delete(this.page);
    this.finished(face);
    if (id === 0) return true;
    this.page.native.send("font.unregister", { id });
    fontsChanged(this.page);
    return true;
  }

  started(face: Face) {
    this.loading.$add(face);
    this.page.delayLoad();
    if (this.loading.size > 1) return;
    const previous = this.ready;
    this.ready = Promise.withResolvers();
    previous.resolve(this.ready.promise);
    this.page.queueTask(() => events.fire(this.js.$impl, "loading"));
  }

  finished(face: Face) {
    if (!this.loading.$delete(face)) return;
    this.done.push(face);
    this.page.allowLoad();
    if (this.loading.size > 0) return;
    const done = this.done.splice(0);
    const fire = (type: string, status: string) => {
      const fontfaces = done.filter(it => it.status === status).map(it => it.js);
      events.dispatch(this.js.$impl, new events.FontFaceSetLoadEvent(type, { fontfaces }));
    };
    this.page.queueTask(() => {
      this.settle();
      fire("loadingdone", "loaded");
      if (done.some(it => it.status === "error")) fire("loadingerror", "error");
    });
  }

  settle() {
    if (this.loading.size === 0) this.ready.resolve(this.js);
  }

  matching(font: unknown, text: unknown): Face[] {
    const parsed = cssom.parseFont(`${font}`);
    if (parsed === null) throw domError("SyntaxError", `Could not resolve '${font}' as a font.`);
    const points = Array.from(`${text}`, it => it.codePointAt(0)!);
    const all = Array.from(this.all(), (face: any): Face => face.$impl);
    return parsed.families.flatMap(family => {
      const faces = all.filter(it => asciiLower(unquote(it.values.family)) === asciiLower(unquote(family)));
      const best = Math.min(...faces.map(it => it.distance(parsed.weight, parsed.isItalic)));
      return faces.filter(it => it.distance(parsed.weight, parsed.isItalic) === best && it.covers(points));
    });
  }
}

function useFont(page: Page, { families, weight, style }: any) {
  if (page.doc.page === null) return;
  const engine = sync(page.doc);
  for (const [family, isGeneric] of families) if (!isGeneric) engine.useFont(family, weight, style !== 0);
  takeRequests(page);
}

class FontFaceSet extends events.EventTarget {
  #fonts: Fonts;

  constructor(fonts: Fonts | null = null) {
    if (!(fonts instanceof Fonts)) core.illegalConstructor();
    super();
    this.#fonts = fonts;
    this.$impl.x = fonts.page;
  }
  get size() {
    return this.#fonts.all().size;
  }
  get status() {
    return this.#fonts.loading.size > 0 ? "loading" : "loaded";
  }
  get ready() {
    if (!(#fonts in this)) return Promise.$reject(new TypeError("Illegal invocation"));
    if (this.#fonts.page.doc.page !== null) sync(this.#fonts.page.doc).updateLayout();
    takeRequests(this.#fonts.page);
    return this.#fonts.ready.promise;
  }
  add(face: FontFace) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.#fonts.add(face.$impl);
    return this;
  }
  delete(face: FontFace) {
    if ($argumentCount() < 1) core.tooFew(1);
    return !face.$impl.isFromCss && this.#fonts.remove(face.$impl);
  }
  clear() {
    for (const face of this.#fonts.faces) this.delete(face as FontFace);
  }
  has(face: FontFace) {
    return this.#fonts.all().$has(face);
  }
  check(font: string, text = " ") {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.#fonts.matching(font, text).every(face => face.status === "loaded" || face.status === "error");
  }
  async load(font: string, text = " ") {
    if ($argumentCount() < 1) core.tooFew(1);
    const faces = this.#fonts.matching(font, text);
    for (const face of faces) face.load(this.#fonts.page);
    return Promise.all(faces.map(face => face.loaded.promise));
  }
  forEach(callback: Function, self: unknown = undefined) {
    for (const face of this.#fonts.all()) callback.$call(self, face, face, this);
  }
  entries() {
    return this.#fonts.all().entries();
  }
  keys() {
    return this.#fonts.all().keys();
  }
  values() {
    return this.#fonts.all().values();
  }
}
Object.defineProperty(FontFaceSet.prototype, Symbol.iterator, {
  value: FontFaceSet.prototype.values,
  writable: true,
  configurable: true,
});
events.defineHandlers(FontFaceSet.prototype, ["loading", "loadingdone", "loadingerror"]);
expose(FontFaceSet);

function fontsOf(page: Page): Fonts {
  return (page.fonts ??= new Fonts(page));
}

function faceFromRule(json: string): Face {
  const { src, "font-family": family, ...others } = JSON.parse(json);
  const given = {} as Descriptors;
  for (const name in others) {
    given[name.replace(/^font-/, "").replace(/-(.)/g, (_, letter) => letter.toUpperCase())] = others[name];
  }
  const js = Object.create(FontFace.prototype);
  const face = new Face(js, { ...descriptors, ...given, family }, src.filter(Boolean));
  $putByIdDirectPrivate(js, "impl", face);
  face.isFromCss = true;
  face.autos = ["weight", "stretch", "style"].filter(it => (given[it] ?? "auto") === "auto");
  return face;
}

function isSameOrigin(page: Page, url: string): boolean {
  return /^(?:data|blob):/.test(url) || URL.parse(url)?.origin === URL.parse(page.doc.url)?.origin;
}

/** What style sheets have asked for. */
function takeRequests(page: Page) {
  const { doc } = page;
  if (doc.page === null) return;
  if (!(sync(doc).pending() & 4)) return;
  const requests = doc.engine.takeRequests();
  for (let i = 0; i < requests.length; i += 2) {
    const value = requests[i + 1];
    if (requests[i] === "image") {
      const picture = usePicture(page, value);
      page.delayLoad();
      picture.done.then(() => {
        if (page.isDisposed) return;
        doc.engine.setImage(value, picture.id, picture.width, picture.height, picture.ratio);
        invalidate(doc);
        page.allowLoad();
      });
      continue;
    }
    if (requests[i] === "release") {
      page.native.send("image.release", { id: +value });
      continue;
    }
    if (requests[i] === "svg") {
      loadExternalSvg(page, value);
      continue;
    }
    const fonts = fontsOf(page);
    if (requests[i] === "font") fonts.faceFor(value).load(page);
    else fonts.setRules(value);
  }
}

// ───────────────────────────── style sheets ─────────────────────────────

class StyleOwner {
  sheet: Sheet | null = null;
  text: string | null = null;
  parserInserted = false;
  isExplicitlyEnabled = false;
  /** Changes when what is being loaded is no longer wanted. */
  serial = 0;
}

function setSheet(node: N, sheet: Sheet | null) {
  const it: StyleOwner = node.x;
  it.sheet?.dispose();
  it.sheet = sheet;
  if (sheet !== null) {
    sheet.owner = node;
    sheet.mediaText = getAttr(node, "media") ?? "";
    if (node.scope === node.doc.node) sheet.title = getAttr(node, "title") ?? "";
    if (sheet.title !== "") sheet.disabled = !isPreferred(node);
  }
  if (node.scope !== null) core.dirtyScope(node.scope);
}

const isAlternate = (node: N) =>
  node.name !== "style" && splitTokens(asciiLower(getAttr(node, "rel") ?? "")).includes("alternate");

function isPreferred(node: N): boolean {
  return node.x.isExplicitlyEnabled || node.x.sheet.title === node.doc.page?.preferredSheets;
}

function preferSheets(page: Page, title: string) {
  if (title === "") return;
  page.preferredSheets = title;
  for (const node of core.scopeOf(page.doc.node).styleNodes)
    if (node.x.sheet?.title) node.x.sheet.disabled = !isPreferred(node);
  core.dirtyScope(page.doc.node);
}

function noteTitle(page: Page, node: N) {
  if (page.preferredSheets === "" && node.scope === page.doc.node && !isAlternate(node))
    page.preferredSheets = getAttr(node, "title") ?? "";
}

const MAX_IMPORTS = 1000;

const charsetRule = /^@charset "([^"]*)";/;

/** Null if there is nothing but the default to go by. */
function encodingOfSheet({ bytes }: Resource, fallback: string): string | null {
  const declared = bytes[0] === 0x40 ? charsetRule.exec(decode(bytes.subarray(0, 1024)))?.[1] : undefined;
  if (declared !== undefined) return /^\s*utf-16/i.test(declared) ? "utf-8" : declared;
  return fallback === "utf-8" ? null : fallback;
}

async function loadImports(
  page: Page,
  sheet: Sheet,
  ancestors: string[],
  budget = { left: MAX_IMPORTS },
): Promise<boolean> {
  const old = sheet.imports;
  if (old.length === 0 && sheet.bytes === null && !sheet.isStale && !/@import/i.test(sheet.chunks[0])) return true;
  const { engine } = page.doc;
  let id = sheet.compile(engine)[0];
  const isWrapped = sheet.prelude.includes("{");
  if (isWrapped) id = engine.createSheet(sheet.chunks[0], sheet.baseUrl, "", 0);
  const imports = engine.sheetImports(id);
  if (isWrapped) engine.releaseSheet(id);
  sheet.imports = [];
  const loading: Promise<boolean>[] = [];
  const from = sheet.href
    ? { referrer: sheet.baseUrl, referrerPolicy: sheet.referrerPolicy || "strict-origin-when-cross-origin" }
    : {};
  for (let i = 0; i < imports.length; i += 2) {
    const [url, modifiers] = imports[i].split("\0");
    if (ancestors.includes(url) || budget.left-- <= 0) continue;
    const prelude = sheet.prelude + imports[i + 1];
    const known = old.findIndex(it => it.href === url);
    if (known >= 0) {
      const [kept] = old.splice(known, 1);
      sheet.imports.push(kept);
      if (kept.prelude === prelude) continue;
      kept.prelude = prelude;
      kept.release();
      loading.push(loadImports(page, kept, [...ancestors, url], budget));
      continue;
    }
    const imported = new Sheet("", url);
    imported.parent = sheet;
    imported.href = url;
    imported.prelude = prelude;
    sheet.imports.push(imported);
    loading.push(
      load(page, url, "style", undefined, { ...from, ...requestOptions(modifiers) }).then(resource => {
        if (resource === null) return false;
        imported.baseUrl = resource.url;
        imported.isTainted = resource.isReadable === false;
        imported.referrerPolicy = resource.referrerPolicy;
        imported.encoding = encodingOfSheet(resource, sheet.encoding ?? page.doc.encoding);
        imported.replace(decodeAs(resource, imported.encoding, page.doc));
        return loadImports(page, imported, [...ancestors, url], budget);
      }),
    );
  }
  for (const it of old) {
    it.parent = null;
    it.dispose();
  }
  return !(await Promise.all(loading)).includes(false);
}

core.hooks.importsChanged = (sheet: Sheet) => {
  let top = sheet;
  while (top.parent !== null) top = top.parent;
  const page = top.owner?.doc.page;
  if (!page) return;
  page.delayLoad();
  loadImports(page, sheet, []).then(() => (sheet.changed(), page.allowLoad()));
};

/** The first frame and the scripts of the parser wait for it. */
function blockOn(page: Page, node: N, loading: Promise<unknown>) {
  const blocks =
    node.x.parserInserted && page.doc.parser !== null && page.doc.engine.matchMedia(getAttr(node, "media") ?? "");
  page.delayLoad();
  if (blocks) page.blockingSheets.$add(loading);
  blockRendering(node, () => asksToBlockRendering(node));
  loading.then(() => {
    page.renderBlockers.$delete(node);
    page.blockingSheets.$delete(loading);
    page.allowLoad();
    invalidate(page.doc);
  });
}

const asksToBlockRendering = (node: N) =>
  (node.flags & CONNECTED) !== 0 && splitTokens(asciiLower(getAttr(node, "blocking") ?? "")).includes("render");

function blockRendering(node: N, goesOn: () => boolean) {
  const { doc } = node;
  if (asksToBlockRendering(node) && doc.isHtml && core.bodyOf(doc) === null)
    doc.page!.renderBlockers.$set(node, goesOn);
}

function isRenderBlocked(page: Page): boolean {
  const { doc, renderBlockers } = page;
  for (const [node, goesOn] of renderBlockers) if (!(node.flags & CONNECTED) || !goesOn()) renderBlockers.$delete(node);
  if (renderBlockers.size > 0 || page.blockingSheets.size > 0) return true;
  return doc.parser !== null && !doc.parser.isFromScript && doc.isHtml && core.bodyOf(doc) === null;
}

/** https://html.spec.whatwg.org/#link-type-expect */
function isExpecting(link: N): boolean {
  const { doc } = link;
  if (doc.parser === null || !splitTokens(asciiLower(getAttr(link, "rel") ?? "")).includes("expect")) return false;
  const [url, fragment] = resolveUrl(doc, getAttr(link, "href") ?? "")?.split("#") ?? [];
  if (fragment === undefined || url !== doc.url.split("#")[0] || !doc.engine.matchMedia(getAttr(link, "media") ?? ""))
    return false;
  const expected = doc.page!.indicatedElement(fragment);
  return expected === null || doc.parser.open.includes(expected);
}

function updateExpectation(link: N) {
  if (link.doc.page !== null && isExpecting(link))
    blockRendering(link, () => asksToBlockRendering(link) && isExpecting(link));
}

function updateStyle(node: N) {
  const it: StyleOwner = node.x;
  const { page } = node.doc;
  const type = asciiLower(getAttr(node, "type") ?? "");
  const text = node.flags & CONNECTED && (type === "" || type === "text/css") ? core.childText(node) : null;
  if (text === it.text && !it.sheet?.parsed) return;
  it.text = text;
  if (
    text === null ||
    (text !== "" && page?.host.allowsInline?.("style", text, node.rare?.nonce, false, wrap(node)) === false)
  ) {
    return setSheet(node, null);
  }
  if (page !== null) noteTitle(page, node);
  setSheet(node, new Sheet(text, node.doc.baseUrl));
  if (page === null) return;
  const serial = ++it.serial;
  const fire = (type: string) => it.serial === serial && events.fire(node, type);
  if (!text.includes("@")) {
    page.delayLoad();
    return page.queueTask(() => (fire("load"), page.allowLoad()));
  }
  const sheet = it.sheet!;
  const loading = loadImports(page, sheet, []).then(isOk => {
    sheet.changed();
    if (it.serial === serial) fireLater(page, node, isOk ? "load" : "error");
  });
  blockOn(page, node, loading);
}

const isBeingParsed = (node: N) =>
  node.ns === core.HTML && node.doc.parser !== null && node.doc.parser.open.at(-1) === node;

function addStyleNode(node: N) {
  core.scopeOf(node.scope!).styleNodes.push(node);
}

function removeStyleNode(node: N, scope: N, isMove: boolean) {
  const list = core.scopeOf(scope).styleNodes;
  const index = list.indexOf(node);
  if (index >= 0) list.splice(index, 1);
  if (isMove) return core.dirtyScope(scope);
  node.x.serial++;
  node.x.text = null;
  if (node.x.sheet === null) return;
  setSheet(node, null);
  core.dirtyScope(scope);
}

function retitle(node: N) {
  if (node.x.sheet !== null && node.scope === node.doc.node) node.x.sheet.title = getAttr(node, "title") ?? "";
}

const styleHooks = {
  created: (node: N) => (node.x = new StyleOwner()),
  inserted(node: N, isMove: boolean) {
    addStyleNode(node);
    if (isMove) core.dirtyScope(node.scope);
    else if (!(node.x.parserInserted = node.doc.parser?.isInserting === true) || node.ns !== core.HTML)
      updateStyle(node);
  },
  removed: removeStyleNode,
  children: (node: N) => isBeingParsed(node) || updateStyle(node),
  parsed: updateStyle,
  attribute(node: N, name: string, _: unknown, value: string | null) {
    if (name === "type") updateStyle(node);
    else if (name === "title") retitle(node);
    else if (name === "media" && node.x.sheet !== null) cssom.setMedia(node.x.sheet, value ?? "");
  },
};
core.kinds.instruction.moved = (node: N, old: N | null) => {
  if (node.name !== "xml-stylesheet" || (old ?? node.parent) !== node.doc.node) return;
  if (old !== null) return removeStyleNode(node, old, false);
  const found = nodes.pseudoAttributes(node);
  found.$set("rel", found.$get("alternate") === "yes" ? "alternate stylesheet" : "stylesheet");
  node.attrs = [...found].flat();
  node.x ??= new StyleOwner();
  addStyleNode(node);
  updateLink(node);
};
const hasSheet = {
  get sheet() {
    return (this as any).$impl.x.sheet?.js ?? null;
  },
};
const styleMembers = {
  get disabled() {
    return (this as any).sheet?.disabled ?? false;
  },
  set disabled(value) {
    if ((this as any).sheet !== null) (this as any).sheet.disabled = value;
  },
};
const HTMLStyleElement = define("HTMLStyleElement", "style", "media type", () => styleMembers, styleHooks);

async function loadSheet(page: Page, node: N, url: string, serial: number) {
  const it: StyleOwner = node.x;
  const resource = await load(page, url, "style", node, {
    blocksRendering: page.doc.parser !== null && core.bodyOf(page.doc) === null,
  });
  if (it.serial !== serial) return;
  if (resource === null) {
    const empty = new Sheet("", url);
    empty.href = url;
    empty.isTainted = true;
    setSheet(node, empty);
    return fireLater(page, node, "error");
  }
  const encoding = encodingOfSheet(resource, getAttr(node, "charset") ?? node.doc.encoding);
  const isPlain = isUtf8(resource, encoding, node.doc);
  const sheet = new Sheet(isPlain ? "" : decodeAs(resource, encoding, node.doc), resource.url);
  if (isPlain) sheet.bytes = resource.bytes;
  sheet.isTainted = resource.isReadable === false;
  sheet.encoding = encoding;
  sheet.referrerPolicy = resource.referrerPolicy;
  sheet.href = url;
  sheet.mediaText = getAttr(node, "media") ?? "";
  const isOk = await loadImports(page, sheet, [url]);
  if (it.serial !== serial) return sheet.dispose();
  setSheet(node, sheet);
  fireLater(page, node, isOk ? "load" : "error");
}

const linkAttributes = new Set(splitTokens("as crossorigin disabled href imagesizes imagesrcset rel type"));
const preloadable = splitTokens("fetch font image json script style track");

function preload(page: Page, node: N, serial: number, loading: Promise<unknown>) {
  const done = (type: string) => page.queueTask(() => node.x.serial === serial && events.fire(node, type));
  loading.then(
    result => done(result === null ? "error" : "load"),
    () => done("error"),
  );
}

const moduleTypes = {
  __proto__: null,
  ...{
    "": "",
    "script": "",
    "worker": "",
    "sharedworker": "",
    "serviceworker": "",
    "audioworklet": "",
    "paintworklet": "",
  },
  ...{ json: "json", style: "css", text: "text" },
};

function updateLink(node: N) {
  const it: StyleOwner = node.x;
  const { page } = node.doc;
  const serial = ++it.serial;
  if (page === null || !(node.flags & CONNECTED)) return;
  const isImageSet = hasAttr(node, "imagesrcset") && asciiLower(getAttr(node, "as") ?? "") === "image";
  const href = isImageSet ? pickFromSet(page, node, node, getAttr(node, "href"))?.url : getAttr(node, "href");
  const url = href ? resolveUrl(node.doc, href) : null;
  const rel = splitTokens(asciiLower(getAttr(node, "rel") ?? ""));
  const isCss = /^(?:text\/css\s*(?:;|$)|$)/i.test(getAttr(node, "type") ?? "");
  const isNamed = !rel.includes("alternate") || it.isExplicitlyEnabled || !!getAttr(node, "title");
  if (url !== null && rel.includes("stylesheet") && isCss && isNamed && !hasAttr(node, "disabled")) {
    noteTitle(page, node);
    return blockOn(page, node, loadSheet(page, node, url, serial));
  }
  if (it.sheet !== null) setSheet(node, null);
  if (url === null) return;
  if (rel.includes("icon")) page.faviconChanged();
  const as = asciiLower(getAttr(node, "as") ?? "");
  if (rel.includes("modulepreload")) {
    const options = { ...fetchingOf(node), integrity: getAttr(node, "integrity") ?? undefined, initiator: "other" };
    const type = moduleTypes[as];
    if (!page.doc.engine.matchMedia(getAttr(node, "media") ?? "")) return;
    preload(
      page,
      node,
      serial,
      type === undefined
        ? Promise.$resolve(null)
        : (page.host.preloadModule ?? page.host.prepareModule)(url, type, options),
    );
  } else if (rel.includes("preload")) {
    if (!preloadable.includes(as) || !page.doc.engine.matchMedia(getAttr(node, "media") ?? "")) return;
    const more = { isPreload: true, integrity: getAttr(node, "integrity"), type: getAttr(node, "type") };
    if (page.host.canPreload?.(as, more.type) === false) return;
    const loading = load(page, url, as === "fetch" ? "" : as, node, more);
    if (as === "style") loading.then(resource => resource !== null && page.doc.engine.prepareSheet(resource.bytes));
    preload(page, node, serial, loading);
  } else if (rel.includes("prefetch")) preload(page, node, serial, load(page, url, "", node, { isPrefetch: true }));
}

const HTMLLinkElement = define(
  "HTMLLinkElement",
  "link",
  `href@ crossOrigin rel as media integrity hreflang type imageSrcset imageSizes referrerPolicy disabled? fetchPriority
  charset rev target`,
  undefined,
  {
    created: styleHooks.created,
    inserted(node: N, isMove: boolean) {
      addStyleNode(node);
      if (isMove) return core.dirtyScope(node.scope);
      node.x.parserInserted = node.doc.parser?.isInserting === true;
      updateLink(node);
      if (node.doc.parser !== null) updateExpectation(node);
    },
    removed: removeStyleNode,
    attribute(node: N, name: string, old: string | null, value: string | null) {
      if (name === "disabled") node.x.isExplicitlyEnabled = value === null;
      if (name === "media" || name === "title") styleHooks.attribute(node, name, old, value);
      else if (old !== value && linkAttributes.$has(name)) updateLink(node);
      if (node.doc.parser !== null) updateExpectation(node);
    },
  },
);
const linkTypes =
  "preload preconnect dns-prefetch stylesheet icon alternate prefetch modulepreload manifest canonical expect";
nodes.defineTokenList(HTMLLinkElement, "relList", "rel", splitTokens(linkTypes));
nodes.defineTokenList(HTMLLinkElement, "sizes", "sizes");
for (const ctor of [HTMLStyleElement, HTMLLinkElement]) {
  core.mixin(hasSheet, ctor);
  nodes.defineTokenList(ctor, "blocking", "blocking", ["render"]);
}

// ───────────────────────────── scripts ─────────────────────────────

class Script {
  parserInserted = false;
  forceAsync = true;
  started = false;
  parserDoc: Doc | null = null;
  hasDuplicateAttributes = false;
  /** What needs no check if Trusted Types are required. */
  trustedText = "";
  /** Where its text begins in the source of the document. */
  line = 0;
  column = 0;
}

function scriptType(node: N): string | null {
  const given = getAttr(node, "type");
  const language = getAttr(node, "language");
  if (given === "" || (given === null && !language)) return "classic";
  const type = asciiLower(given?.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "") ?? "text/" + language);
  if (type === "module" || type === "importmap") return type.length === given!.length ? type : null;
  return /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(
    type,
  )
    ? "classic"
    : null;
}

/** Undefined if the markup around it looks as if it had been injected. */
function nonceOf(node: N): string | undefined {
  const nonce = node.rare?.nonce;
  if (!nonce || node.name !== "script") return nonce;
  const isSuspect = wrap(node)
    .getAttributeNames()
    .some(name => /<(?:script|style|link)/i.test(name + getAttr(node, name)));
  return isSuspect || node.x.hasDuplicateAttributes ? undefined : nonce;
}

function fetchingOf(node: N) {
  return {
    nonce: nonceOf(node),
    credentials:
      getAttr(node, "crossorigin") === null
        ? undefined
        : wrap(node).crossOrigin === "use-credentials"
          ? "include"
          : "same-origin",
    referrerPolicy: wrap(node).referrerPolicy,
  };
}

function runClassic(page: Page, node: N, source: string, url: string, options: object) {
  const { doc } = page;
  const before = doc.currentScript;
  doc.currentScript = core.rootOf(node).flags & flags.SHADOW_ROOT ? null : node;
  events.callBack(page, () => page.host.runClassicScript?.(source, url, options), undefined);
  doc.currentScript = before;
}

function isUtf8({ charset, bytes }: Resource, label: string | null, doc: Doc) {
  if (bytes[0] >= 0xfe) return false;
  return charset === undefined ? label === null && doc.encoding === "utf-8" : /^utf-?8$/i.test(charset);
}

function decodeAs(resource: Resource, label: string | null, doc: Doc): string {
  if (isUtf8(resource, label, doc)) return decode(resource.bytes);
  const mime = require("internal/desktop/web/mime");
  return mime.decode(
    resource.bytes,
    mime.encodingOf(resource.charset) ?? mime.encodingOf(label ?? undefined) ?? doc.encoding,
  );
}

/** Starts to load it. The result runs it. */
function fetchScript(page: Page, node: N, type: string, url: string | null, source: string): Promise<() => unknown> {
  const { host, doc } = page;
  const fetching = fetchingOf(node);
  const failed = () => () => node.doc === doc && events.fire(node, "error");
  if (type === "module") {
    const { line, column, parserInserted } = node.x as Script;
    const options = { ...fetching, integrity: getAttr(node, "integrity") ?? undefined, byScript: !parserInserted };
    const preparing =
      url === null
        ? host.prepareInlineModule(source, doc.url, doc.baseUrl, fetching, line, column)
        : host.prepareModule(url, options);
    return preparing.then(
      run => () => {
        if (node.doc !== doc) return;
        doc.ignoresDestructiveWrites++;
        events.callBack(page, run, undefined);
        doc.ignoresDestructiveWrites--;
        if (url !== null) events.fire(node, "load");
      },
      failed,
    );
  }
  const charset = getAttr(node, "charset");
  return load(page, url!, "script", node).then(resource => {
    if (resource === null) return failed();
    return () => {
      if (node.doc !== doc) return;
      doc.ignoresDestructiveWrites++;
      runClassic(page, node, decodeAs(resource, charset, doc), resource.url, {
        ...fetching,
        isMuted: resource.isReadable === false,
      });
      doc.ignoresDestructiveWrites--;
      events.fire(node, "load");
    };
  });
}

function isForAnotherEvent(node: N): boolean {
  const [event, target] = [getAttr(node, "event"), getAttr(node, "for")].map(
    it => it && asciiLower(it).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ""),
  );
  return event !== null && target !== null && (target !== "window" || (event !== "onload" && event !== "onload()"));
}

const MAX_SPECULATIONS = 16;

/** https://html.spec.whatwg.org/#speculative-html-parsing */
function speculate(page: Page, parser: $Dom.Parser) {
  const { input, at } = parser;
  if (input.length === parser.speculatedLength || input.indexOf("<", at) < 0 || parser.xml !== null) return;
  if (++parser.speculations > MAX_SPECULATIONS || parser.isInTemplate() || !page.host.allowsSpeculation?.()) return;
  parser.speculatedLength = input.length;
  const rest = require("internal/desktop/dom/parser").parseInert(parser.current(), input.slice(at));
  const { doc } = rest;
  const { baseUrl, encoding } = doc;
  let hasBase = core.findDescendant(page.doc.node, it => isHtml(it, "base") && hasAttr(it, "href")) !== null;
  let referrerPolicy: string | undefined;
  const fetch = (node: N, href: string | null | undefined, destination: string, more?: object) => {
    const url = href ? resolveUrl(doc, href) : null;
    if (url === null || !/^https?:/.test(url)) return;
    const policy = referrerPolicy !== undefined && !hasAttr(node, "referrerpolicy") ? { referrerPolicy } : undefined;
    return load(page, url, destination, node, { isPreload: true, parserInserted: true, ...policy, ...more });
  };
  const visit = (root: N): boolean => {
    for (let node = root.first; node !== null; node = core.following(node, root)) {
      if (node.flags & flags.HOST && !visit(node.rare!.shadow!)) return false;
      if (node.ns === core.SVG) {
        if (node.name === "image" || node.name === "script") fetch(node, core.svgHref(node), node.name);
      } else if (node.ns !== core.HTML) continue;
      else if (node.name === "img") {
        if (asciiLower(getAttr(node, "loading") ?? "") !== "lazy") fetch(node, pickSource(page, node)?.url, "image");
      } else if (node.name === "video") fetch(node, getAttr(node, "poster"), "image");
      else if (node.name === "script") {
        const type = scriptType(node);
        if (type === "module")
          fetch(node, getAttr(node, "src"), "script", { crossOrigin: getAttr(node, "crossorigin") ?? "" });
        else if (type === "classic" && !hasAttr(node, "nomodule")) fetch(node, getAttr(node, "src"), "script");
      } else if (node.name === "link") {
        const rel = splitTokens(asciiLower(getAttr(node, "rel") ?? ""));
        const as = asciiLower(getAttr(node, "as") ?? "");
        if (!page.doc.engine.matchMedia(getAttr(node, "media") ?? "")) continue;
        if (rel.includes("stylesheet")) {
          if (rel.includes("alternate") || hasAttr(node, "disabled")) continue;
          fetch(node, getAttr(node, "href"), "style", { blocksRendering: core.bodyOf(page.doc) === null })?.then(
            resource => resource !== null && page.doc.engine.prepareSheet(resource.bytes),
          );
        } else if (rel.includes("preload") && as !== "fetch" && !hasAttr(node, "imagesrcset")) {
          if (page.host.canPreload?.(as, getAttr(node, "type"))) fetch(node, getAttr(node, "href"), as);
        }
      } else if (node.name === "base" && !hasBase && (hasBase = hasAttr(node, "href"))) {
        doc.baseUrl = resolveUrl(doc, getAttr(node, "href")!) ?? doc.baseUrl;
      } else if (node.name === "meta") {
        if (hasAttr(node, "http-equiv") && !/^content-(?:type|language)$/i.test(getAttr(node, "http-equiv")!))
          return false;
        if (asciiLower(getAttr(node, "name") ?? "") === "referrer") {
          if ((referrerPolicy = asciiLower(getAttr(node, "content") ?? "")) !== "no-referrer") return false;
        }
      }
    }
    return true;
  };
  Object.assign(doc, { baseUrl: page.doc.baseUrl, encoding: page.doc.encoding });
  visit(rest);
  Object.assign(doc, { baseUrl, encoding });
}

function pauseParser(page: Page, until: Promise<() => unknown>) {
  const parser = page.doc.parser!;
  parser.paused = true;
  speculate(page, parser);
  Promise.all([until, ...page.blockingSheets]).then(([run]) => {
    if (page.isDisposed || page.doc.parser !== parser) return;
    parser.paused = false;
    page.runAsTask(() => parser.whileWriting(run));
    page.queueTask(() => parser.run());
  });
}

/** https://html.spec.whatwg.org/#prepare-the-script-element */
function prepareScript(node: N) {
  const it: Script = node.x;
  const { doc } = node;
  const { page } = doc;
  const src = node.ns === core.HTML ? getAttr(node, "src") : core.svgHref(node);
  const type = scriptType(node);
  if (it.started) return;
  let source = core.childText(node);
  if (page?.trusted && !it.parserInserted && source !== it.trustedText && node.flags & CONNECTED) {
    try {
      source = page.trusted(
        "script",
        source,
        node.ns === core.HTML ? "HTMLScriptElement text" : "SVGScriptElement text",
      );
    } catch {
      return;
    }
  }
  const { parserInserted, forceAsync } = it;
  it.forceAsync ||= parserInserted && !hasAttr(node, "async");
  it.parserInserted = false;
  if (!(node.flags & CONNECTED) || type === null || (src === null && source === "")) return;
  it.parserInserted = parserInserted;
  it.forceAsync = forceAsync;
  it.started = true;
  if (page === null || page.host.runsScripts === false || (parserInserted && it.parserDoc !== doc)) return;
  if (type === "classic" && (hasAttr(node, "nomodule") || isForAnotherEvent(node))) return;
  const details = { nonce: nonceOf(node), byScript: !parserInserted, element: wrap(node) };
  if (src === null && page.host.allowsInlineScript?.(source, "element", details) === false)
    return fireLater(page, node, "error");
  const byParser = parserInserted && doc.parser !== null;
  if (type === "importmap") {
    if (src !== null) return fireLater(page, node, "error");
    return events.callBack(page, () => page.host.addImportMap?.(source, doc.baseUrl), undefined);
  }
  if (src === null && type === "classic") {
    const options = { ...fetchingOf(node), inline: true, base: doc.baseUrl, line: it.line, column: it.column };
    const run = () => node.doc === doc && runClassic(page, node, source, doc.url, options);
    if (!byParser) run();
    else if (page.blockingSheets.size > 0 && doc.parser!.scripts === 0) pauseParser(page, Promise.$resolve(run));
    else doc.parser!.whileWriting(run);
    return;
  }
  const url = src ? resolveUrl(doc, src) : null;
  if (src !== null && url === null) return fireLater(page, node, "error");
  let loading = fetchScript(page, node, type, url, source);
  if (hasAttr(node, "blocking")) {
    const blocksParser = byParser && type === "classic" && !hasAttr(node, "async") && !hasAttr(node, "defer");
    blockRendering(node, () => blocksParser || asksToBlockRendering(node));
    loading = loading.then(run => () => {
      page.renderBlockers.$delete(node);
      invalidate(doc);
      return run();
    });
  }
  const isAsync = hasAttr(node, "async") || it.forceAsync;
  if (byParser && !isAsync) {
    if (type === "module" || hasAttr(node, "defer")) page.deferredScripts.push(loading);
    else pauseParser(page, loading);
    return;
  }
  page.delayLoad();
  const turn = isAsync ? loading : page.orderedScripts.then(() => loading);
  const ran = turn
    .then(run => new Promise<void>(resolve => page.queueTask(() => (run(), resolve()))))
    .then(() => page.allowLoad());
  if (!isAsync) page.orderedScripts = ran;
}

const prepareUnlessParsing = (node: N) => node.x.parserInserted || prepareScript(node);
const scriptHooks = {
  created: (node: N) => (node.x = new Script()),
  cloned: (from: N, to: N) => (to.x.started = from.x.started),
  inserted: (node: N, isMove: boolean) => isMove || prepareUnlessParsing(node),
  children: (node: N, isMove: boolean) => isMove || prepareUnlessParsing(node),
  attribute(node: N, name: string, old: string | null) {
    if (name === "async") node.x.forceAsync = false;
    else if (name === "src" && old === null) prepareUnlessParsing(node);
  },
};
const HTMLScriptElement = define(
  "HTMLScriptElement",
  "script",
  "src@ type noModule? charset defer? crossOrigin integrity referrerPolicy fetchPriority event htmlFor",
  () => ({
    get async() {
      return (this as any).$impl.x.forceAsync || hasAttr((this as any).$impl, "async");
    },
    set async(value) {
      (this as any).$impl.x.forceAsync = false;
      core.toggleAttr((this as any).$impl, "async", !!value);
      core.react();
    },
  }),
  scriptHooks,
);
core.mixin(html.hasText, HTMLScriptElement);
nodes.defineTokenList(HTMLScriptElement, "blocking", "blocking", ["render"]);
core.extend(HTMLScriptElement, ctor => {
  ctor.supports = (type: string) => type === "classic" || type === "module" || type === "importmap";
});

// ───────────────────────────── frames ─────────────────────────────

type Frame = { window: any; setRect?(rect: object, visible: boolean): void; dispose(): void };
const remoteFrames = () => require("internal/desktop/dom/remote_frame");

function framesOf(page: Page): N[] {
  return Array.from(page.frames)
    .filter(node => node.scope === page.doc.node)
    .sort(core.compareOrder);
}

function framesChanged(page: Page) {
  const window = page.window;
  const frames = framesOf(page);
  for (let i = page.frameCount; i < frames.length; i++) {
    Object.defineProperty(window, i, { value: undefined, enumerable: true, configurable: true });
  }
  for (let i = frames.length; i < page.frameCount; i++) delete window[i];
  page.frameCount = frames.length;
  frames.forEach((node, i) => Object.defineProperty(window, i, { value: node.x.window }));
  core.hooks.namesChanged(page.doc);
}
core.hooks.framesChanged = framesChanged;

function frameName(node: N): string {
  const given = getAttr(node, "name") ?? "";
  const { local } = node.x;
  return local === undefined || local.context.name === given
    ? given
    : local.document() === null
      ? ""
      : local.context.name;
}

function renderFrames(page: Page) {
  page.hasDirtyFrames = false;
  for (const node of Array.from(page.frames)) node.x?.local?.render();
}

function closeFrame(node: N) {
  if (node.x === null) return;
  const frame: Frame = node.x;
  node.doc.page!.frames.$delete(node);
  framesChanged(node.doc.page!);
  frame.dispose();
  if (node.x === frame) node.x = null;
}

function openFrame(node: N) {
  const { page } = node.doc;
  if (page === null || !(node.flags & CONNECTED)) return;
  const url = hasAttr(node, "srcdoc") ? "about:srcdoc" : resolveUrl(node.doc, getAttr(node, "src") || "about:blank");
  const isLocal = !!page.host.isLocalFrame?.(url ?? "about:blank");
  if (node.x?.isRemote && !!node.x.isLocal === isLocal) return node.x.navigate();
  closeFrame(node);
  if (isLocal) return openLocalFrame(node, page);
  const isBlank =
    !hasAttr(node, "srcdoc") && resolveUrl(node.doc, getAttr(node, "src") || "about:blank") === "about:blank";
  if (!isBlank) return openRemoteFrame(node, page);
  node.x = page.createBlankFrame(node);
  page.frames.$add(node);
  framesChanged(page);
  events.fire(node, "load");
}

function openRemoteFrame(node: N, page: Page, url?: string) {
  closeFrame(node);
  if (!page.host.createRemoteFrame) return;
  node.x = new (remoteFrames().RemoteFrame)(node, page);
  page.frames.$add(node);
  framesChanged(page);
  page.hasRemoteFrames = true;
  page.layoutVersion = -1;
  invalidate(node.doc);
  node.x.navigate(url);
}

function openLocalFrame(node: N, page: Page) {
  node.x = new (require("internal/desktop/dom/local_frame").LocalFrame)(node, page);
  page.frames.$add(node);
  page.hasRemoteFrames = true;
  page.layoutVersion = -1;
  if (node.id !== 0) node.doc.engine.setReplaced(node.id, node.x.image, 300, 150, NaN);
  invalidate(node.doc);
  framesChanged(page);
  node.x.navigate(true);
}

core.hooks.frameOf = node => node.x;

function contentDocument({ x: frame }: N) {
  return frame === null ? null : frame.isRemote ? (frame.local?.document() ?? null) : frame.window.document;
}

const frameMembers = () => ({
  get contentWindow() {
    return (this as any).$impl.x?.window ?? null;
  },
  get contentDocument() {
    return contentDocument((this as any).$impl);
  },
});
const svgDocumentMembers = () => ({
  getSVGDocument(this: any) {
    const found = contentDocument(this.$impl);
    return found?.contentType === "image/svg+xml" ? found : null;
  },
});
const frameHooks = {
  mirrored: (node: N) =>
    node.doc.engine.setReplaced(
      node.id,
      node.x?.image ?? 0,
      node.x?.naturalWidth ?? 300,
      node.x?.naturalHeight ?? 150,
      NaN,
    ),
  inserted(node: N, isMove: boolean) {
    if (!isMove) openFrame(node);
    else if (node.x !== null) framesChanged(node.doc.page!);
  },
  removed: (node: N, _: N, isMove: boolean) => isMove || closeFrame(node),
  attribute: (node: N, name: string) =>
    name === "src" || name === "srcdoc" ? openFrame(node) : node.x?.attributeChanged?.(name),
};
define(
  "HTMLFrameElement",
  "frame",
  "name scrolling src@ frameBorder longDesc@ noResize? marginHeight marginWidth",
  frameMembers,
  frameHooks,
);

function placeFrames(page: Page) {
  for (const node of page.frames) {
    const [left, top] = html.boundingRect(node);
    const [x, y, width, height] = page.doc.engine.boxSizes(node.id);
    const [borderLeft, borderTop] = page.doc.engine.clientMetrics(node.id);
    const rect = { x: left + borderLeft + x, y: top + borderTop + y, width, height };
    (node.x as Frame).setRect?.(rect, (html.styleBits(node) & 3) === 3);
  }
}

const emptyBox = (node: N) => node.doc.engine.setReplaced(node.id, 0, 300, 150, NaN);
const HTMLIFrameElement = define(
  "HTMLIFrameElement",
  "iframe",
  `src@ srcdoc name allow allowFullscreen? width height referrerPolicy loading csp credentialless? align scrolling
  frameBorder longDesc@ marginHeight marginWidth`,
  () => Object.assign(frameMembers(), svgDocumentMembers()),
  frameHooks,
);
nodes.defineTokenList(HTMLIFrameElement, "sandbox", "sandbox");

/** What an `<object>` or `<embed>` shows if that is not a document. */
class Plugin {
  picture: Picture | null = null;
  isQueued = false;
  isRendered = false;
  /** The fallback content of an `<object>`, and nothing for an `<embed>`. */
  hasFailed = true;
}
const plugins = new WeakMap<N, Plugin>();
const isPlugin = (node: N) => isHtml(node, "object") || isHtml(node, "embed");
const isDocumentType = /^(?:text\/(?:html|plain|xml)|application\/(?:xhtml\+)?xml|image\/svg\+xml)$/;
const pluginAttributes = new Set(["src", "data", "type", "classid"]);

function showPlugin(node: N) {
  if (node.id === 0) return;
  const { picture, hasFailed } = plugins.get(node)!;
  const { engine } = node.doc;
  if (picture?.id) engine.setReplaced(node.id, picture.id, picture.width, picture.height, picture.ratio);
  else if (!hasFailed) {
    const [width, height, ratio] = node.x?.naturalSize() ?? [300, 150, NaN];
    engine.setReplaced(node.id, node.x?.image ?? 0, width, height, ratio);
  } else engine.clearReplaced(node.id);
  invalidate(node.doc);
}

function setFailed(node: N, hasFailed: boolean) {
  const it = plugins.get(node)!;
  const hasChanged = it.hasFailed !== hasFailed;
  it.hasFailed = hasFailed;
  showPlugin(node);
  if (hasChanged && node.first !== null) core.filterDescendants(node, isPlugin).forEach(queuePluginUpdate);
}

function emptyPlugin(node: N) {
  const it = plugins.get(node)!;
  closeFrame(node);
  it.picture?.release();
  it.picture = null;
}

function failPlugin(node: N) {
  emptyPlugin(node);
  setFailed(node, true);
  if (node.name === "object") fireLater(node.doc.page!, node, "error");
}

async function showPluginImage(node: N, url: string) {
  const it = plugins.get(node)!;
  const page = node.doc.page!;
  page.delayLoad();
  emptyPlugin(node);
  const picture = (it.picture = usePicture(page, url, node));
  await picture.done;
  if (it.picture === picture) {
    if (picture.id === 0) failPlugin(node);
    else {
      showPlugin(node);
      fireLater(page, node, "load");
    }
  }
  page.allowLoad();
}

function isInactive(node: N): boolean {
  for (let at = node.parent; at !== null; at = at.parent) {
    if (isHtml(at, "audio") || isHtml(at, "video") || (isHtml(at, "object") && !plugins.get(at)!.hasFailed))
      return true;
  }
  return false;
}

const sourceOfPlugin = (node: N) => getAttr(node, node.name === "object" ? "data" : "src");
const typeOfPlugin = (node: N) =>
  asciiLower(getAttr(node, "type") ?? "")
    .split(";")[0]
    .trim();
const namesContent = (node: N) =>
  !(node.name === "object" && getAttr(node, "classid")) &&
  (!!sourceOfPlugin(node) || isDocumentType.test(typeOfPlugin(node)));
const isRendered = (node: N) => (html.styleBits(node) & 0x101) !== 0;

function updatePlugin(node: N, page: Page) {
  const it = plugins.get(node)!;
  it.isQueued = false;
  if (!(node.flags & CONNECTED) || node.doc.page !== page) return;
  it.isRendered = isRendered(node);
  if (!it.isRendered || !namesContent(node) || isInactive(node)) return emptyPlugin(node);
  const url = resolveUrl(node.doc, sourceOfPlugin(node) || "about:blank");
  const type = typeOfPlugin(node);
  if (url === null || url.startsWith("javascript:")) return failPlugin(node);
  if (type !== "" && isSupportedImage.test(type) && !isDocumentType.test(type)) return showPluginImage(node, url);
  if (!page.host.isLocalFrame?.(url)) return failPlugin(node);
  if (node.x !== null && node.name === "embed") return node.x.navigate();
  emptyPlugin(node);
  openLocalFrame(node, page);
}

function queuePluginUpdate(node: N) {
  const it = plugins.get(node)!;
  const { page } = node.doc;
  setFailed(node, !namesContent(node));
  if (it.isQueued || page === null || !(node.flags & CONNECTED)) return;
  it.isQueued = true;
  page.delayLoad();
  page.queueTask(() => {
    updatePlugin(node, page);
    page.allowLoad();
  });
}

function updateRenderedPlugins(page: Page) {
  for (const node of page.plugins) {
    const it = plugins.get(node)!;
    if (!it.isQueued && it.isRendered !== isRendered(node)) queuePluginUpdate(node);
  }
}

const pluginHooks = {
  created: (node: N) => plugins.set(node, new Plugin()),
  mirrored: showPlugin,
  inserted(node: N, isMove: boolean) {
    if (isMove) return;
    node.doc.page?.plugins.$add(node);
    queuePluginUpdate(node);
  },
  removed(node: N, _: N, isMove: boolean) {
    if (isMove) return;
    node.doc.page?.plugins.$delete(node);
    emptyPlugin(node);
  },
  attribute: (node: N, name: string) => pluginAttributes.$has(name) && queuePluginUpdate(node),
};
define("HTMLEmbedElement", "embed", "src@ type width height align name", svgDocumentMembers, pluginHooks);

// ───────────────────────────── media ─────────────────────────────

class TimeRanges {
  get length() {
    return 0;
  }
  start() {
    if ($argumentCount() < 1) core.tooFew(1);
    throw domError("IndexSizeError", "There are no ranges.");
  }
  end() {
    if ($argumentCount() < 1) core.tooFew(1);
    throw domError("IndexSizeError", "There are no ranges.");
  }
}
class MediaError {
  declare $impl: number;
  get code() {
    return this.$impl;
  }
  get message() {
    return this.$impl === 4 ? "Format error" : "";
  }
}
class TextTrackList extends events.EventTarget {
  get length() {
    return 0;
  }
  getTrackById() {
    if ($argumentCount() < 1) core.tooFew(1);
    return null;
  }
  *[Symbol.iterator]() {}
}
expose(TimeRanges);
expose(TextTrackList);
expose(MediaError, { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 });

const playable =
  /^(?:audio[/](?:aac|flac|mp3|mp4|mpeg|ogg|wav|wave|webm|x-m4a|x-wav)|video[/](?:mp4|ogg|webm|x-m4v))\s*(?:;|$)/i;
const needData = ["canplay", "canplaythrough", "durationchange", "loadeddata", "loadedmetadata"];

class Media {
  currentTime = 0;
  volume = 1;
  muted = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  srcObject = null;
  sinkId = "";
  currentSrc = "";
  duration = NaN;
  readyState = 0;
  networkState = 0;
  paused = true;
  seeking = false;
  error: MediaError | null = null;
  poster: Picture | null = null;
  videoWidth = 0;
  videoHeight = 0;
  showsPoster = true;
  /** The ids in the library of the current frame, and of the one that may still be on the screen. */
  frames: number[] = [];
  frameCallbacks = new Map<number, Function>();
  presented = 0;
  /** What has the `src`. */
  holder: N | null = null;
  isWaiting = false;
  selected: Promise<void> | undefined;
  serial = 0;
  #player: any;

  constructor(readonly node: N) {}

  get loop() {
    return hasAttr(this.node, "loop");
  }
  /** Undefined unless there is one already, or it `isNeeded`. */
  player(isNeeded = true) {
    const { node } = this;
    const { page } = node.doc;
    if (this.#player || !isNeeded) return this.#player;
    const fetch = async () => (this.currentSrc === "" ? null : load(page!, this.currentSrc, node.name, node));
    return (this.#player = page?.host.createPlayer?.(this, (type: string) => events.fire(node, type), fetch));
  }
  isSeen() {
    const { node } = this;
    if (this.frameCallbacks.$size > 0 || !(node.flags & CONNECTED)) return true;
    const { top, right, bottom, left } = wrap(node).getBoundingClientRect();
    const { innerWidth, innerHeight, document } = node.doc.page!.window;
    return document.visibilityState === "visible" && right > 0 && bottom > 0 && left < innerWidth && top < innerHeight;
  }
  /** The part of the border box that has the picture. */
  fitted() {
    const { x, y, width, height } = wrap(this.node).getBoundingClientRect();
    const scale = Math.min(width / this.videoWidth, height / this.videoHeight);
    const [w, h] = [this.videoWidth * scale, this.videoHeight * scale];
    return { x: x + (width - w) / 2, y: y + (height - h) / 2, width: w, height: h };
  }
  /** Its width, and the scale of the controls. */
  pictureWanted() {
    const { scale } = this.node.doc.page!;
    const { width } = this.fitted();
    if (hasAttr(this.node, "controls") && width > 0) return [Math.ceil(width * scale), scale];
    const covered = this.paused ? 0 : wrap(this.node).clientWidth * 1.5 * scale;
    return [Math.ceil(Math.min(covered || Infinity, this.videoWidth)), 0];
  }
  async show(bytes: Uint8Array, isWanted: () => boolean) {
    const page = this.node.doc.page;
    const id = (
      await page?.native.request("image.decode", { blob: page.native.putBlob(bytes) }).then(undefined, () => {})
    )?.id;
    if (!id) return;
    if (!isWanted()) return page!.native.send("image.release", { id });
    if (this.frames.length === 0) videos.register(this, this.frames);
    if (this.frames.unshift(id) > 2) page!.native.send("image.release", { id: this.frames.pop() });
    showPoster(this.node);
    this.presented++;
    if (this.frameCallbacks.$size === 0) return;
    const callbacks = [...this.frameCallbacks.values()];
    this.frameCallbacks.$clear();
    page!.window.requestAnimationFrame((now: number) => {
      const { videoWidth: width, videoHeight: height, presented: presentedFrames } = this;
      const about = {
        presentationTime: now,
        expectedDisplayTime: now,
        width,
        height,
        mediaTime: this.#player.time(),
        presentedFrames,
      };
      for (const callback of callbacks) events.callBack(page!, () => callback(now, about));
    });
  }
  /** False if that is up to a `<source>` to tell. */
  fail(code: number) {
    const { node, holder, serial } = this;
    if (holder === node || holder === null || code !== 4) {
      this.error = Object.assign(new MediaError(), { $impl: code });
      this.networkState = code === 4 ? 3 : 1;
      return true;
    }
    this.#player?.unload();
    this.networkState = 3;
    node.doc.page?.queueTask(() => {
      if (serial !== this.serial) return;
      events.fire(holder, "error");
      if (serial === this.serial) this.tryNextSource();
    });
    return false;
  }
  tryNextSource() {
    const next = nextSource(this.node, this.holder);
    if ((this.isWaiting = next === null)) return;
    this.currentSrc = urlOfSource((this.holder = next!));
    trySource(this.node);
  }
}

const releaseFrames = (frames: number[]) =>
  frames.splice(0).forEach(id => core.realm.page.native?.send("image.release", { id }));
const videos = new FinalizationRegistry(releaseFrames);

/** The next child to try. */
function nextSource(node: N, after: N | null) {
  let at = after === null ? node.first : after.next;
  while (at !== null && !isHtml(at, "source")) at = at.next;
  return at;
}

/** Empty if it cannot be played. */
function urlOfSource(holder: N) {
  const isSource = holder.name === "source";
  if (isSource && !playable.test(getAttr(holder, "type") || "audio/wav")) return "";
  if (isSource && holder.doc.engine?.matchMedia(getAttr(holder, "media") ?? "") === false) return "";
  return resolveUrl(holder.doc, getAttr(holder, "src") || "//") ?? "";
}

/** https://html.spec.whatwg.org/#media-element-load-algorithm. Nothing is fetched until something waits for it. */
function loadMedia(node: N) {
  const it: Media = node.x;
  const serial = ++it.serial;
  const later = (type: string) => node.doc.page?.queueTask(() => events.fire(node, type));
  it.player(false)?.unload();
  it.isWaiting = false;
  if (it.networkState === 1 || it.networkState === 2) later("abort");
  if (it.networkState !== 0) later("emptied");
  Object.assign(it, {
    currentTime: 0,
    duration: NaN,
    readyState: 0,
    paused: true,
    seeking: false,
    error: null,
    currentSrc: "",
  });
  it.videoWidth = it.videoHeight = 0;
  it.showsPoster = true;
  if (it.frames.length > 0) (releaseFrames(it.frames), showPoster(node));
  it.playbackRate = it.defaultPlaybackRate;
  it.networkState = 3;
  it.selected = new Promise<void>(resolve =>
    queueMicrotask(() => {
      if (serial === it.serial) selectSource(node, serial);
      resolve();
    }),
  );
}

function selectSource(node: N, serial: number) {
  const it: Media = node.x;
  it.holder = it.srcObject || hasAttr(node, "src") ? node : nextSource(node, null);
  if (it.holder === null) return void (it.networkState = 0);
  it.networkState = 2;
  it.currentSrc = it.srcObject ? "" : urlOfSource(it.holder);
  node.doc.page?.queueTask(() => {
    if (serial !== it.serial) return;
    events.fire(node, "loadstart");
    if (serial === it.serial) trySource(node);
  });
}

function trySource(node: N) {
  const it: Media = node.x;
  if (!node.doc.page?.host.createPlayer || (it.currentSrc === "" && !it.srcObject)) {
    return void (it.fail(4) && events.fire(node, "error"));
  }
  it.networkState = 1;
  const isBlank = node.name === "video" && node.flags & CONNECTED && it.poster === null;
  const isAwaited =
    getAttr(node, "preload") !== "none" && (isBlank || needData.some(type => events.hasListeners(node, type)));
  if (isLazy(node) && it.paused && !(node.flags & CONNECTED && it.isSeen())) return;
  if (hasAttr(node, "autoplay") || !it.paused) play(node).then(undefined, () => {});
  else if (isAwaited) it.player().load();
  else events.fire(node, "suspend");
}

const hasEnded = (it: Media) => it.readyState > 0 && !it.loop && it.player().time() >= it.duration;

async function play(node: N) {
  const it: Media = node.x;
  if (it.networkState === 0) loadMedia(node);
  const player = it.error?.code !== 4 && it.player();
  if (!player) throw domError("NotSupportedError", "The element has no supported sources.");
  it.showsPoster = false;
  if (it.paused) {
    it.paused = false;
    node.doc.page?.queueTask(() => events.fire(node, "play"));
  }
  await it.selected;
  if (it.networkState === 0 || (it.holder !== node && it.currentSrc === "")) return new Promise<void>(() => {});
  await player.play();
}

const HTMLMediaElement = define(
  "HTMLMediaElement",
  "",
  "src@ crossOrigin loading preload autoplay? loop? controls? defaultMuted? disableRemotePlayback?",
  () => ({
    get error() {
      return (this as any).$impl.x.error;
    },
    get textTracks() {
      return same((this as any).$impl, "textTracks", () => new TextTrackList());
    },
    get buffered() {
      return new TimeRanges();
    },
    get played() {
      return new TimeRanges();
    },
    get seekable() {
      return new TimeRanges();
    },
    get ended() {
      return hasEnded((this as any).$impl.x);
    },
    get currentTime() {
      const it: Media = (this as any).$impl.x;
      return it.player(false)?.time() ?? it.currentTime;
    },
    set currentTime(value) {
      const it: Media = (this as any).$impl.x;
      if (!Number.isFinite((value = +value))) throw new TypeError("The provided double value is non-finite.");
      it.currentTime = value;
      it.showsPoster = false;
      it.player()?.seek(value);
    },
    get srcObject() {
      return (this as any).$impl.x.srcObject;
    },
    set srcObject(value) {
      (this as any).$impl.x.srcObject = value ?? null;
      loadMedia((this as any).$impl);
    },
    canPlayType(this: any, type: string) {
      if ($argumentCount() < 1) core.tooFew(1);
      if (!playable.test((type = `${type}`))) return "";
      return /codecs=|^audio[/](?:aac|flac|mp3|mpeg)/i.test(type) ? "probably" : "maybe";
    },
    load(this: any) {
      loadMedia(this.$impl);
    },
    async play(this: any) {
      await play(this.$impl);
    },
    pause(this: any) {
      const node: N = this.$impl;
      if (node.x.networkState === 0) loadMedia(node);
      if (node.x.paused) return;
      node.x.player().pause();
      node.x.paused = true;
      for (const type of ["timeupdate", "pause"]) node.doc.page?.queueTask(() => events.fire(node, type));
    },
    async setSinkId(this: any, id: string) {
      await this.$impl.x.player(false)?.setSinkId(`${id}`);
      this.$impl.x.sinkId = `${id}`;
    },
  }),
);
core.extend(HTMLMediaElement, ctor => {
  expose(ctor, {
    ...{ NETWORK_EMPTY: 0, NETWORK_IDLE: 1, NETWORK_LOADING: 2, NETWORK_NO_SOURCE: 3 },
    ...{ HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4 },
  });
  core.defineGetters(
    ctor,
    splitTokens("currentSrc duration networkState paused readyState seeking sinkId"),
    (self, name) => self.$impl.x[name],
  );
  for (const name of splitTokens("volume muted playbackRate defaultPlaybackRate preservesPitch")) {
    core.accessor(
      ctor.prototype,
      name,
      function (this: any) {
        return this.$impl.x[name];
      },
      function (this: any, value) {
        const node: N = this.$impl;
        value = typeof node.x[name] === "boolean" ? !!value : +value;
        if (value !== value || value === Infinity || value === -Infinity)
          throw new TypeError("The provided double value is non-finite.");
        if (name === "volume" && (value < 0 || value > 1))
          throw domError("IndexSizeError", "The volume is outside the range [0, 1].");
        if (node.x[name] === value) return;
        node.x[name] = value;
        node.x.player(false)?.set(name, value);
        const type = name === "preservesPitch" ? "" : name.endsWith("Rate") ? "ratechange" : "volumechange";
        if (type) node.doc.page?.queueTask(() => events.fire(node, type));
      },
    );
  }
});

function showPoster(node: N) {
  const { poster, showsPoster, frames, videoWidth, videoHeight }: Media = node.x;
  if (node.id === 0) return;
  if (frames.length > 0 && !(showsPoster && poster?.id)) {
    node.doc.engine.setReplaced(node.id, frames[0], videoWidth, videoHeight, videoWidth / videoHeight);
  } else if (!poster?.id) return emptyBox(node);
  else node.doc.engine.setReplaced(node.id, poster.id, poster.width, poster.height, poster.ratio);
  invalidate(node.doc);
}

const mediaHooks = {
  created: (node: N) => (node.x = new Media(node)),
  children(node: N) {
    if (node.x.networkState === 0) nextSource(node, null) === null || loadMedia(node);
    else if (node.x.isWaiting) queueMicrotask(() => node.x.isWaiting && node.x.tryNextSource());
  },
  removed: (node: N, _: N, isMove: boolean) =>
    isMove || node.x.paused || node.doc.page?.queueTask(() => node.flags & CONNECTED || wrap(node).pause()),
  mirrored: showPoster,
  activate(node: N, { clientX, clientY, isTrusted }: any) {
    const it: Media = node.x;
    if (!isTrusted || !hasAttr(node, "controls")) return;
    const { x, y, width, height } = it.fitted();
    if (clientY > y + height - 22)
      wrap(node).currentTime = Math.max(0, Math.min(1, (clientX - x - 16) / (width - 32))) * it.duration;
    else if (it.paused) play(node).then(undefined, () => {});
    else wrap(node).pause();
  },
  attribute(node: N, name: string, _: unknown, value: string | null) {
    const { page } = node.doc;
    if (name === "src" && value !== null) loadMedia(node);
    else if (name === "loop") node.x.player(false)?.set(name, value !== null);
    if (name !== "poster" || page === null) return;
    const url = value ? resolveUrl(node.doc, value) : null;
    node.x.poster?.release();
    node.x.poster = url === null ? null : usePicture(page, url);
    if (url === null) return showPoster(node);
    page.delayLoad();
    node.x.poster.done.then(() => {
      showPoster(node);
      page.allowLoad();
    });
  },
};
const HTMLAudioElement = define("HTMLAudioElement", "audio", "", undefined, mediaHooks, HTMLMediaElement);
let lastFrameCallback = 0;
const HTMLVideoElement = define(
  "HTMLVideoElement",
  "video",
  "width+0 height+0 poster@ playsInline? disablePictureInPicture?",
  () => ({
    get videoWidth() {
      return (this as any).$impl.x.videoWidth;
    },
    get videoHeight() {
      return (this as any).$impl.x.videoHeight;
    },
    requestVideoFrameCallback(this: any, callback: Function) {
      if (!$isCallable(callback)) throw new TypeError("parameter 1 is not of type 'Function'.");
      this.$impl.x.frameCallbacks.$set(++lastFrameCallback, callback);
      return lastFrameCallback;
    },
    cancelVideoFrameCallback(this: any, id: number) {
      this.$impl.x.frameCallbacks.$delete(id >>> 0);
    },
  }),
  mediaHooks,
  HTMLMediaElement,
);

function Audio(src?: string) {
  const node = core.createPlainElement(core.realm.page.doc, "audio", core.HTML);
  setAttr(node, "preload", "auto");
  if (src !== undefined) setAttr(node, "src", String(src));
  return wrap(node);
}
html.defineFactory("Audio", Audio, HTMLAudioElement);

function dispose(page: Page) {
  page.frames.forEach(closeFrame);
  for (const it of page.pictures.values()) it.free();
  if (page.fonts !== null) page.native?.send("font.dropScope", { scope: page.fontScope });
}

export default {
  scriptType,
  canvas,
  flushCanvases,
  dispose,
  fontsOf,
  hasSheet,
  isRenderBlocked,
  openRemoteFrame,
  loadLazyImages,
  failPlugin,
  frameMembers,
  pluginHooks,
  reselectAutoSizedImages,
  reselectImages,
  showPlugin,
  showPluginImage,
  showButtonImage,
  updateButtonImage,
  buttonSize,
  svgDocumentMembers,
  updateRenderedPlugins,
  closeFrame,
  frameName,
  framesOf,
  placeFrames,
  renderFrames,
  prepareScript,
  scriptHooks,
  styleHooks,
  styleMembers,
  svgImageHooks,
  svgImageMembers,
  preferSheets,
  takeRequests,
  useHooks,
};
