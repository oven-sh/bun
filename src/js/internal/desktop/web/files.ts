// `FileReader` and `FileReaderSync`.
const idl = require("internal/desktop/web/idl");
const mime = require("internal/desktop/web/mime");
const { ProgressEvent } = require("internal/desktop/web/dom").events;

const { error, need, scope } = idl;

function blobOf(value: unknown): Blob {
  if (!$inheritsBlob(value)) throw new TypeError("parameter 1 is not of type 'Blob'.");
  return value;
}

function partsOf(given: any): any[] {
  if (!$isObject(given)) throw new TypeError("The provided value cannot be converted to a sequence.");
  const parts: unknown[] = [];
  for (const part of given)
    parts.push(typeof part === "string" || $inheritsBlob(part) || idl.bytesOf(part) ? part : `${part}`);
  return parts;
}

/** The arguments of the constructor of `File`, as the native one takes them. */
function convert(parts: any[], options: unknown) {
  const given = idl.dictionary(options);
  const endings = given.endings;
  if (endings !== undefined && idl.oneOf(endings, ["native", "transparent"]) === "native") {
    const ending = process.platform === "win32" ? "\r\n" : "\n";
    parts = parts.map(part => (typeof part === "string" ? part.replace(/\r\n?|\n/g, ending) : part));
  }
  let type = given.type;
  type = type === undefined ? "" : `${type}`;
  const time = given.lastModified;
  return [parts, { type, lastModified: time === undefined ? time : Math.trunc(+time) || 0 }];
}

type Convert = (bytes: Uint8Array, blob: Blob, label?: string) => unknown;
const asBuffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const toArrayBuffer: Convert = bytes => new Uint8Array(bytes).buffer;
const toBinaryString: Convert = bytes => asBuffer(bytes).latin1Slice();
const toDataUrl: Convert = (bytes, { type }) =>
  `data:${type || "application/octet-stream"};base64,${asBuffer(bytes).base64Slice()}`;
const toText: Convert = (bytes, { type }, label) =>
  mime.decode(bytes, mime.encodingOf(label) ?? mime.encodingOf(mime.parse(type)?.parameters.get("charset")));

class FileReader extends idl.EventTarget {
  #state = 0;
  #result: unknown = null;
  #error: unknown = null;
  #run = 0;

  get readyState() {
    return this.#state;
  }
  get result() {
    return this.#result;
  }
  get error() {
    return this.#error;
  }

  #fire(type: string, loaded: number, total: number, dispatch = idl.dispatchInTask) {
    dispatch(this, new ProgressEvent(type, { lengthComputable: true, loaded, total }));
  }

  #read(blob: Blob, convert: Convert, label?: string) {
    if (this.#state === 1) throw error("InvalidStateError", "The object is already busy reading Blobs.");
    const run = ++this.#run;
    const { size } = blob;
    this.#state = 1;
    this.#result = this.#error = null;
    const step = (task: () => void) => idl.queueTask(() => run === this.#run && task());
    const finish = (type: string, settle: () => void) => {
      step(() => this.#fire("loadstart", 0, size));
      if (type === "load" && size > 0) step(() => this.#fire("progress", size, size));
      step(() => {
        this.#state = 2;
        settle();
        this.#fire(type, size, size);
        if (this.#state !== 1) this.#fire("loadend", size, size);
      });
    };
    blob.bytes().then(
      bytes => finish("load", () => (this.#result = convert(bytes, blob, label))),
      failure => finish("error", () => (this.#error = error("NotReadableError", failure.message))),
    );
  }

  readAsArrayBuffer(blob: Blob) {
    this.#read(blobOf(blob), toArrayBuffer);
  }
  readAsBinaryString(blob: Blob) {
    this.#read(blobOf(blob), toBinaryString);
  }
  readAsText(blob: Blob, encoding: any = undefined) {
    this.#read(blobOf(blob), toText, encoding === undefined ? encoding : `${encoding}`);
  }
  readAsDataURL(blob: Blob) {
    this.#read(blobOf(blob), toDataUrl);
  }

  abort() {
    this.#result = null;
    if (this.#state !== 1) return;
    this.#run++;
    this.#state = 2;
    this.#error = error("AbortError", "The read was aborted.");
    this.#fire("abort", 0, 0, idl.dispatch);
    if (this.#state !== 1) this.#fire("loadend", 0, 0, idl.dispatch);
  }
}
idl.defineHandlers(FileReader.prototype, ["loadstart", "progress", "load", "abort", "error", "loadend"]);
idl.expose(FileReader, ["EMPTY", "LOADING", "DONE"]);

class FileReaderSync {
  #read(blob: unknown, convert: Convert, label?: string) {
    return convert(scope.env.readBlobSync(blobOf(blob)), blob as Blob, label);
  }

  readAsArrayBuffer(blob: Blob) {
    return this.#read(blob, toArrayBuffer);
  }
  readAsBinaryString(blob: Blob) {
    return this.#read(blob, toBinaryString);
  }
  readAsText(blob: Blob, encoding: any = undefined) {
    need(arguments.length, 1);
    return this.#read(blob, toText, encoding === undefined ? encoding : `${encoding}`);
  }
  readAsDataURL(blob: Blob) {
    return this.#read(blob, toDataUrl);
  }
}
idl.expose(FileReaderSync);

const blobOfType = (parts: Uint8Array[], type: string) => new Blob(parts as any, { type });

export default { convert, partsOf, FileReader, FileReaderSync, blobOfType };
