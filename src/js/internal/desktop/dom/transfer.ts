// Files, the clipboard, and what is dragged.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const { iterable, kList, makeList } = require("internal/desktop/dom/node");

const { asciiLower, domError, expose, illegalConstructor } = core;

type N = $Dom.N;
type Page = $Dom.Page;

class FileList {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
}
iterable(FileList, false);
expose(FileList);

function fileList(files: () => File[]) {
  return makeList(FileList, { size: () => files().length, at: index => files()[index] });
}

type Item = { type: string; text: string; file: File | null; js: object | null };

const enum Mode {
  ReadWrite,
  ReadOnly,
  /** Only the types can be read. */
  Protected,
  Disabled,
}

class Store {
  items: Item[] = [];
  mode = Mode.ReadWrite;
  dropEffect = "none";
  effectAllowed = "none";
  image: N | null = null;
  list: object | null = null;
  files: object | null = null;
  types: readonly string[] | null = null;

  get(type: string): string {
    return this.items.find(item => item.file === null && item.type === type)?.text ?? "";
  }
  set(type: string, text: string) {
    this.items = this.items.filter(item => item.file !== null || item.type !== type);
    this.items.push({ type, text, file: null, js: null });
    this.types = null;
  }
  addFile(file: File) {
    this.items.push({ type: file.type, text: "", file, js: null });
    this.types = null;
  }
  keep(test: (item: Item, index: number) => boolean) {
    const kept = this.items.filter(test);
    if (kept.length === this.items.length) return;
    this.items = kept;
    this.types = null;
  }
  fileItems(): File[] {
    return this.mode > Mode.ReadOnly ? [] : this.items.flatMap(item => item.file ?? []);
  }
}

function normalizeType(format: string): string {
  const type = asciiLower(String(format)).trim();
  if (type === "text" || type.startsWith("text/plain;")) return "text/plain";
  return type === "url" ? "text/uri-list" : type;
}

class DataTransferItem {
  declare $impl: { store: Store; item: Item };

  constructor() {
    illegalConstructor();
  }
  get kind() {
    const { store, item } = this.$impl;
    return store.mode === Mode.Disabled ? "" : item.file === null ? "string" : "file";
  }
  get type() {
    return this.$impl.store.mode === Mode.Disabled ? "" : this.$impl.item.type;
  }
  getAsString(callback: Function | null) {
    if ($argumentCount() < 1) core.tooFew(1);
    const { store, item } = this.$impl;
    if (callback && item.file === null && store.mode <= Mode.ReadOnly) {
      setImmediate(events.callBack, null, callback, undefined, item.text);
    }
  }
  getAsFile() {
    return this.$impl.store.mode <= Mode.ReadOnly ? this.$impl.item.file : null;
  }
  webkitGetAsEntry() {
    const file = this.getAsFile();
    if (file === null) return null;
    const isDirectory = !!core.realm.page.host.isDirectory?.(file);
    return {
      isFile: !isDirectory,
      isDirectory,
      name: file.name,
      fullPath: "/" + file.name,
      file: (callback: Function) => setImmediate(events.callBack, null, callback, undefined, file),
      createReader: () => ({ readEntries: callback => setImmediate(events.callBack, null, callback, undefined, []) }),
    };
  }
}

function wrapItem(store: Store, item: Item | undefined) {
  if (item === undefined) return undefined;
  if (item.js === null) (item.js = Object.create(DataTransferItem.prototype)).$impl = { store, item };
  return item.js;
}

class DataTransferItemList {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  add(data: any, type: string | undefined = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    const store: Store = this[kList].store;
    if (store.mode !== Mode.ReadWrite) return null;
    if ($inheritsBlob(data) && data.name !== undefined) store.addFile(data);
    else if (store.items.some(item => item.file === null && item.type === asciiLower(String(type)))) {
      throw domError("NotSupportedError", `An item already exists for type '${type}'.`);
    } else store.set(asciiLower(String(type)), String(data));
    return wrapItem(store, store.items.at(-1));
  }
  remove(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    const store: Store = this[kList].store;
    if (store.mode !== Mode.ReadWrite) throw domError("InvalidStateError", "The list is not writable.");
    store.keep((_, i) => i !== index >>> 0);
  }
  clear() {
    if (this[kList].store.mode === Mode.ReadWrite) this[kList].store.keep(() => false);
  }
}
iterable(DataTransferItemList, false);

const effects = core.splitTokens("none copy copyLink copyMove link linkMove move all uninitialized");

class DataTransfer {
  declare $impl: Store;

  constructor() {
    this.$impl = new Store();
  }
  get dropEffect() {
    return this.$impl.dropEffect;
  }
  set dropEffect(value) {
    if (["none", "copy", "link", "move"].includes(value)) this.$impl.dropEffect = value;
  }
  get effectAllowed() {
    return this.$impl.effectAllowed;
  }
  set effectAllowed(value) {
    if (this.$impl.mode === Mode.ReadWrite && effects.includes(value)) this.$impl.effectAllowed = value;
  }
  get items() {
    const store = this.$impl;
    const size = () => (store.mode === Mode.Disabled ? 0 : store.items.length);
    return (store.list ??= makeList(DataTransferItemList, { store, size, at: i => wrapItem(store, store.items[i]) }));
  }
  get types() {
    const { items, mode } = this.$impl;
    if (mode === Mode.Disabled) return Object.freeze([]);
    const types = items.filter(item => item.file === null).map(item => item.type);
    return (this.$impl.types ??= Object.freeze(types.length < items.length ? [...types, "Files"] : types));
  }
  get files() {
    const store = this.$impl;
    return (store.files ??= fileList(() => store.fileItems()));
  }
  getData(format: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (this.$impl.mode > Mode.ReadOnly) return "";
    const text = this.$impl.get(normalizeType(format));
    if (asciiLower(String(format)).trim() !== "url") return text;
    return text.split(/\r?\n/).find(line => line !== "" && line[0] !== "#") ?? "";
  }
  setData(format: string, data: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    if (this.$impl.mode === Mode.ReadWrite) this.$impl.set(normalizeType(format), String(data));
  }
  clearData(format: string | undefined = undefined) {
    const store = this.$impl;
    if (store.mode !== Mode.ReadWrite) return;
    const isKept = (item: Item) => item.file !== null || (format !== undefined && item.type !== normalizeType(format));
    store.keep(isKept);
  }
  setDragImage(image: any) {
    if ($argumentCount() < 3) core.tooFew(3);
    this.$impl.image = core.nodeOf(image);
  }
}
for (const ctor of [DataTransferItem, DataTransferItemList, DataTransfer]) expose(ctor);

/** The system's clipboard takes text and HTML. The other types are known for as long as it has that text. */
let written: Store | null = null;
let wroteImage = false;

function readClipboard(page: Page, kind?: string): DataTransfer {
  const { clipboard } = page.host;
  const transfer = new DataTransfer();
  const store = transfer.$impl;
  const text: string = clipboard ? clipboard.readText(kind) : (written?.get("text/plain") ?? "");
  const paths: string[] = clipboard?.readFilePaths?.(kind) ?? [];
  const image = paths.length > 0 ? null : clipboard?.readImage?.(kind);
  const hasImage = !!image && !image.isEmpty();
  if (text === written?.get("text/plain") && (text !== "" || hasImage === wroteImage))
    store.items = written.items.slice();
  else {
    const markup: string = clipboard?.readHTML?.(kind) ?? "";
    if (text !== "") store.set("text/plain", text);
    if (markup !== "") store.set("text/html", markup);
  }
  for (const path of paths) store.addFile(page.host.fileFromPath(path));
  if (hasImage) {
    store.addFile(new File([new Uint8Array(image.toPNG())], "image.png", { type: "image/png" }));
  }
  store.mode = Mode.ReadOnly;
  return transfer;
}

function writeClipboard(page: Page, store: Store, png?: Uint8Array) {
  written = new Store();
  written.items = store.items.filter(it => it.file === null);
  wroteImage = png !== undefined;
  if (png !== undefined) page.host.clipboard?.writeImage(png);
  else if (store.get("text/html") === "" || !page.host.clipboard?.write) {
    page.host.clipboard?.writeText(store.get("text/plain"));
  } else page.host.clipboard.write({ text: store.get("text/plain"), html: store.get("text/html") });
}

const isCustom = /^web [^\s/;]+[/][^\s/;]+$/;
let readItem: (items: Record<string, unknown>) => ClipboardItem;

class ClipboardItem {
  #items: Record<string, any>;
  #style: string;
  /** What this process had last written when the item was read. */
  #readAfter: Store | null | undefined;

  static {
    readItem = items => {
      const item = new ClipboardItem(items);
      item.#readAfter = written;
      return item;
    };
  }

  constructor(items: Record<string, any>, options: { presentationStyle?: string } | undefined = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (Object.keys(items).length === 0) throw new TypeError("Empty dictionary argument");
    this.#items = { ...items };
    this.#style = options?.presentationStyle ?? "unspecified";
  }
  static supports(type: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return ["text/plain", "text/html", "image/png"].includes((type = `${type}`)) || isCustom.test(type);
  }
  get types() {
    return Object.freeze(Object.keys(this.#items));
  }
  get presentationStyle() {
    return this.#style;
  }
  async getType(type: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (!Object.hasOwn(this.#items, type)) throw domError("NotFoundError", "The type was not found");
    if (this.#readAfter !== undefined && this.#readAfter !== written) {
      throw domError("InvalidStateError", "The clipboard has changed.");
    }
    const value = await this.#items[type];
    return typeof value === "string" ? new Blob([value], { type }) : value;
  }
}

class Clipboard extends events.EventTarget {
  #page: Page;

  constructor(page: Page) {
    super();
    this.#page = page;
  }
  async #allow(permission: string) {
    if ((await this.#page.host.permission?.(permission)) === "denied") {
      throw domError("NotAllowedError", "Permission denied.");
    }
  }
  async readText() {
    await this.#allow("clipboard-read");
    return readClipboard(this.#page).getData("text/plain");
  }
  async writeText(text: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    await this.#allow("clipboard-sanitized-write");
    const store = new Store();
    store.set("text/plain", String(text));
    writeClipboard(this.#page, store);
  }
  async read(formats: any = undefined) {
    if (formats?.unsanitized !== undefined) {
      const types = [...formats.unsanitized];
      if (types.length > 1 || (types.length === 1 && types[0] !== "text/html")) {
        throw domError("NotAllowedError", "Only text/html can be read unsanitized.");
      }
    }
    await this.#allow("clipboard-read");
    const { items } = readClipboard(this.#page).$impl;
    if (items.length === 0) return [];
    return [readItem(Object.fromEntries(items.map(item => [item.type, item.file ?? item.text])))];
  }
  async write(items: ClipboardItem[]) {
    if ($argumentCount() < 1) core.tooFew(1);
    items = [...items];
    if (!items.every(it => it instanceof ClipboardItem))
      throw new TypeError("The items have to be of type 'ClipboardItem'.");
    await this.#allow("clipboard-sanitized-write");
    if (items.length > 1) throw domError("NotAllowedError", "Support for multiple ClipboardItems is not implemented.");
    if (items[0]?.types.filter(it => isCustom.test(it)).length > 100)
      throw domError("NotAllowedError", "Too many custom formats.");
    const store = new Store();
    let png: Uint8Array | undefined;
    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (!ClipboardItem.supports(type) || (blob.type.split(";")[0] !== type && "web " + blob.type !== type)) {
          throw domError("NotAllowedError", `Type ${type} is not supported, or does not match the type of the blob.`);
        }
        if (type === "image/png") {
          png = await blob.bytes();
          if (png![0] !== 0x89 || png![1] !== 0x50) throw domError("DataError", "Failed to read or decode the image.");
        } else store.set(type, await blob.text());
      }
    }
    writeClipboard(this.#page, store, png);
  }
}
expose(ClipboardItem);
expose(Clipboard);

function base64(bytes: Uint8Array): string {
  return (bytes as any).toBase64();
}

class FileReader extends events.EventTarget {
  #state = 0;
  #result: any = null;
  #error: any = null;
  #serial = 0;
  #size = 0;

  get readyState() {
    return this.#state;
  }
  get result() {
    return this.#result;
  }
  get error() {
    return this.#error;
  }
  #fire(type: string, loaded: number) {
    events.dispatch(this.$impl, new events.ProgressEvent(type, { lengthComputable: true, loaded, total: this.#size }));
  }
  #read(blob: Blob, convert: (bytes: Uint8Array) => unknown) {
    if (!$inheritsBlob(blob)) throw new TypeError("parameter 1 is not of type 'Blob'.");
    if (this.#state === 1) throw domError("InvalidStateError", "The object is already busy reading Blobs.");
    const serial = ++this.#serial;
    const step = (run: () => void) => setImmediate(() => serial === this.#serial && run());
    const finish = (type: string) => {
      this.#state = 2;
      this.#fire(type, this.#size);
      if (this.#state === 2) this.#fire("loadend", this.#size);
    };
    this.#state = 1;
    this.#result = this.#error = null;
    this.#size = blob.size;
    step(() => this.#fire("loadstart", 0));
    blob.bytes().then(
      bytes =>
        step(() => {
          this.#fire("progress", this.#size);
          if (serial !== this.#serial) return;
          this.#result = convert(bytes);
          finish("load");
        }),
      error =>
        step(() => {
          this.#error = domError("NotReadableError", error.message);
          finish("error");
        }),
    );
  }
  readAsArrayBuffer(blob: Blob) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.#read(blob, bytes => bytes.slice().buffer);
  }
  readAsBinaryString(blob: Blob) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.#read(blob, bytes => atob(base64(bytes)));
  }
  readAsText(blob: Blob, encoding = "utf-8") {
    if ($argumentCount() < 1) core.tooFew(1);
    this.#read(blob, bytes => new TextDecoder(encoding as any).decode(bytes));
  }
  readAsDataURL(blob: Blob) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.#read(blob, bytes => `data:${blob.type || "application/octet-stream"};base64,${base64(bytes)}`);
  }
  abort() {
    this.#result = null;
    if (this.#state !== 1) return;
    this.#serial++;
    this.#state = 2;
    this.#error = domError("AbortError", "The read was aborted.");
    this.#fire("abort", 0);
    this.#fire("loadend", 0);
  }
}
events.defineHandlers(FileReader.prototype, ["loadstart", "progress", "load", "abort", "error", "loadend"]);
expose(FileReader, { EMPTY: 0, LOADING: 1, DONE: 2 });

export default {
  READ_WRITE: Mode.ReadWrite,
  READ_ONLY: Mode.ReadOnly,
  PROTECTED: Mode.Protected,
  DISABLED: Mode.Disabled,
  Clipboard,
  DataTransfer,
  FileList,
  Store,
  base64,
  fileList,
  readClipboard,
  writeClipboard,
};
